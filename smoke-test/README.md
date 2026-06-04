# Smoke-test SiGPo

Verifica **en vivo** (navegador real + datos reales de Supabase) los fixes de la
auditoría: inicia sesión por rol y comprueba el DOM ya poblado.

Es **read-only**: sólo navega a reportes y lee la pantalla. No crea ni borra nada.

## Uso

```bash
cd smoke-test
cp credenciales.example.json credenciales.json   # 1) crear config
#   editá credenciales.json y poné la contraseña real de cada rol que quieras probar
#   (los DNI ya vienen cargados; dejá password "" para saltear un rol)
./run.sh                                          # 2) instala Playwright y corre
```

Resultado: un resumen `PASS / FAIL / SKIP` en consola y un screenshot de cada
página en `screenshots/`.

## Qué verifica

| ID  | Rol           | Comprobación |
|-----|---------------|--------------|
| M13 | SECRETARIA    | Proyección de ingresos sin filas demo + tasa de cobranza real (no 87% fijo) |
| M12 | SECRETARIA    | Reporte de morosidad: columna "Días Prom." con valores reales |
| M14a| SECRETARIA    | Tasa de deserción sin filas demo |
| M14b| ADMINISTRADOR | Ingresos ejecutados sin tarjetas demo |
| M7  | ADMINISTRADOR | Gestión de programas: stats Maestrías/Cursos numéricos |
| L1  | SECRETARIA    | Tablas con wrapper `overflow-x:auto` (scroll horizontal) |
| M6  | SECRETARIA    | Vista facturación carga sin error JS de consola |

Además, cada página falla el check si arroja un **error de JavaScript en consola**.

## Notas

- `credenciales.json`, `screenshots/` y `node_modules/` están en `.gitignore`
  (no se suben).
- El login usa Supabase Auth de producción, por eso necesitás contraseñas reales.
- Si querés correrlo contra GitHub Pages en vez de localhost, cambiá `baseUrl`
  en `credenciales.json`.
