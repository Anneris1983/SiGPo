#!/usr/bin/env node
/*
 * Smoke-test SiGPo — verifica EN VIVO los fixes de la auditoría.
 *
 * Qué hace:
 *   1. Levanta un servidor estático del repo (carpeta padre) en baseUrl.
 *   2. Por cada rol con contraseña cargada, abre portal_login.html, inicia
 *      sesión real contra Supabase y navega a las páginas que tocamos.
 *   3. Corre asserts concretos sobre el DOM ya poblado con datos reales.
 *   4. Guarda un screenshot de cada página en screenshots/.
 *   5. Imprime un reporte PASS/FAIL y termina con código de salida acorde.
 *
 * Es READ-ONLY: sólo navega a reportes y lee el DOM. No crea ni borra datos.
 *
 * Uso:
 *   cp credenciales.example.json credenciales.json   # y completá las passwords
 *   node smoke.js                                     # (run.sh instala Playwright)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('\n❌ Falta Playwright. Corré:  ./run.sh   (o: npm i playwright && npx playwright install chromium)\n');
  process.exit(2);
}

// ── Config ────────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');               // raíz del repo
const CRED_PATH = path.join(__dirname, 'credenciales.json');
if (!fs.existsSync(CRED_PATH)) {
  console.error('\n❌ No existe credenciales.json. Copialo de credenciales.example.json y completá las passwords.\n');
  process.exit(2);
}
const CRED = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
const BASE = CRED.baseUrl || 'http://127.0.0.1:8088';
const PORT = Number(new URL(BASE).port || 8088);

// ── Helpers de assert ───────────────────────────────────────────────────────
function ok(cond, msg)            { if (!cond) throw new Error(msg); }
function mustHave(text, needle)   { ok(text.includes(needle),  `esperaba encontrar «${needle}»`); }
function mustNotHave(text, needle){ ok(!text.includes(needle), `NO debería aparecer «${needle}» (dato demo / hardcodeado)`); }

// ── Definición de checks por página ──────────────────────────────────────────
// Cada check: { id, rol, path, run(page) }  — run() lanza Error si falla.
const CHECKS = [
  {
    id: 'M13', rol: 'SECRETARIA',
    desc: 'Proyección de ingresos: sin filas demo y tasa de cobranza real',
    path: 'secretaria_9_reporte_proyeccion_ingresos.html',
    async run(page) {
      const body = await page.innerText('body');
      mustNotHave(body, 'Maestría en Agronegocios');      // fila demo
      mustNotHave(body, '$5,892,000');                    // monto demo
      mustNotHave(body, 'Diplomado ODS');                 // fila demo
      // La tarjeta de "Tasa de cobranza" (3ra) debe ser un % numérico, no vacío
      const tasa = (await page.locator('.summary-card').nth(2).locator('.summary-value').innerText()).trim();
      ok(/\d/.test(tasa) && tasa.includes('%'), `la tasa debería ser un % numérico, vi «${tasa}»`);
      ok(tasa !== '87.0%' && tasa !== '87%', `la tasa no debería ser el 87% hardcodeado (vi «${tasa}»)`);
    }
  },
  {
    id: 'M12', rol: 'SECRETARIA',
    desc: 'Reporte de morosidad: columna "Días Prom." con valores reales',
    path: 'secretaria_8_reporte_morosidad.html',
    async run(page) {
      const body = await page.innerText('body');
      // Debe haber aparecido al menos un "N días" en la tabla (o el total)
      ok(/\d+\s*d[ií]as/i.test(body), 'esperaba ver algún valor "N días" en la columna Días Prom.');
    }
  },
  {
    id: 'M14a', rol: 'SECRETARIA',
    desc: 'Tasa de deserción: sin filas demo hardcodeadas',
    path: 'secretaria_15_reporte_tasa_desercion.html',
    async run(page) {
      const body = await page.innerText('body');
      mustNotHave(body, 'Esp. en Costos y Gestión');      // fila demo
      mustNotHave(body, '6.3%');                          // valor demo
    }
  },
  {
    id: 'M14b', rol: 'ADMINISTRADOR',
    desc: 'Ingresos ejecutados: sin tarjetas demo hardcodeadas',
    path: 'administrador_14_reporte_ingresos_ejecutados.html',
    async run(page) {
      const body = await page.innerText('body');
      mustNotHave(body, '$4,875,000');                    // monto demo
      mustNotHave(body, 'MAGNAGRO');                      // programa demo
    }
  },
  {
    id: 'M7', rol: 'ADMINISTRADOR',
    desc: 'Gestión de programas: stats numéricos (Maestrías/Cursos separados)',
    path: 'administrador_10_gestion_programas_cohortes.html',
    async run(page) {
      const mae = (await page.locator('#stat-mae').innerText()).trim();
      const cur = (await page.locator('#stat-cur').innerText()).trim();
      ok(/^\d+$/.test(mae), `stat-mae debería ser numérico, vi «${mae}»`);
      ok(/^\d+$/.test(cur), `stat-cur debería ser numérico, vi «${cur}»`);
    }
  },
  {
    id: 'L1', rol: 'SECRETARIA',
    desc: 'Tablas con wrapper de scroll horizontal (overflow-x:auto)',
    path: 'secretaria_8_reporte_morosidad.html',
    async run(page) {
      const n = await page.locator('div[style*="overflow-x:auto"]').count();
      ok(n >= 1, 'esperaba al menos un contenedor con overflow-x:auto envolviendo la tabla');
    }
  },
  {
    id: 'M6', rol: 'SECRETARIA',
    desc: 'Vista facturación estudiante: carga sin error de consola JS',
    path: 'vista_facturacion_estudiante.html',
    async run(page) {
      // El propio runner registra errores de consola; acá sólo confirmamos que renderizó algo.
      const body = await page.innerText('body');
      ok(body.length > 0, 'la página quedó en blanco');
    }
  },
];

// ── Servidor estático mínimo ──────────────────────────────────────────────
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.json':'application/json', '.ico':'image/x-icon' };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/portal_login.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ── Login ────────────────────────────────────────────────────────────────
async function login(page, rol, dni, password) {
  await page.goto(`${BASE}/portal_login.html`, { waitUntil: 'networkidle' });
  await page.fill('#dni', dni);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL(u => !u.toString().includes('portal_login'), { timeout: 20000 }),
    page.click('#btnLogin'),
  ]).catch(async () => {
    const err = await page.locator('#errorMsg').innerText().catch(() => '');
    throw new Error(`login falló para ${rol}${err ? ' — ' + err.trim() : ' (no redirigió)'}`);
  });
}

// ── Runner ───────────────────────────────────────────────────────────────
(async () => {
  const server = await startServer();
  console.log(`\n🌐 Server local en ${BASE} (sirviendo ${ROOT})`);
  const browser = await chromium.launch();
  const results = [];

  // Agrupar checks por rol para loguear una sola vez por rol
  const byRol = {};
  for (const c of CHECKS) (byRol[c.rol] = byRol[c.rol] || []).push(c);

  for (const rol of Object.keys(byRol)) {
    const cred = (CRED.roles || {})[rol];
    if (!cred || !cred.password) {
      for (const c of byRol[rol]) results.push({ ...c, status: 'SKIP', detail: 'sin password en credenciales.json' });
      console.log(`\n⏭️  ${rol}: sin password, salteado`);
      continue;
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(String(e.message || e)));

    try {
      console.log(`\n🔑 Login ${rol} (DNI ${cred.dni})…`);
      await login(page, rol, cred.dni, cred.password);
      console.log(`   ✓ sesión iniciada`);

      for (const c of byRol[rol]) {
        consoleErrors.length = 0;
        try {
          await page.goto(`${BASE}/${c.path}`, { waitUntil: 'networkidle', timeout: 25000 });
          await page.waitForTimeout(1800); // dar tiempo a que las queries pueblen el DOM
          await page.screenshot({ path: path.join(__dirname, 'screenshots', `${c.id}_${c.path.replace(/\.html$/,'')}.png`), fullPage: true });
          await c.run(page);
          const jsErr = consoleErrors.filter(e => !/favicon|net::ERR/i.test(e));
          if (jsErr.length) throw new Error('error JS en consola: ' + jsErr[0]);
          results.push({ ...c, status: 'PASS', detail: '' });
          console.log(`   ✅ [${c.id}] ${c.desc}`);
        } catch (err) {
          results.push({ ...c, status: 'FAIL', detail: err.message });
          console.log(`   ❌ [${c.id}] ${c.desc}\n        → ${err.message}`);
        }
      }
    } catch (err) {
      for (const c of byRol[rol]) results.push({ ...c, status: 'FAIL', detail: err.message });
      console.log(`   ❌ ${err.message}`);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();
  server.close();

  // ── Reporte final ──
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  console.log('\n──────────────── RESUMEN ────────────────');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️ ';
    console.log(`${icon} [${r.id}] ${r.rol.padEnd(13)} ${r.desc}${r.detail ? '  — ' + r.detail : ''}`);
  }
  console.log(`──────────────────────────────────────────`);
  console.log(`PASS: ${pass}   FAIL: ${fail}   SKIP: ${skip}`);
  console.log(`📸 Screenshots en smoke-test/screenshots/\n`);
  process.exit(fail > 0 ? 1 : 0);
})();
