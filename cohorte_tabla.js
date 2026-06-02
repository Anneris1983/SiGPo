/* ══════════════════════════════════════════════════════════════════
   cohorte_tabla.js — Lógica COMPARTIDA de la tabla de cuotas de una cohorte.

   Usado por las cuatro vistas de tabla de cohorte:
     - administrador_4_cohorte.html
     - coordinador_3_cohorte.html
     - Secretaria_4_Tabla.html
     - profesor_3_cohorte.html

   Objetivo: una sola fuente de verdad para la máquina de estados de cuotas
   y el cálculo de mora, evitando que cada vista mantenga su propia copia
   (que es como aparecían bugs corregidos en una vista pero no en otras).

   Depende de helpers definidos en supabase.js (cargar SIEMPRE después):
     redondear2, tieneMontoDefinido, calcMontoAbonado, vencioCuota, getSupabase
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════
   MÁQUINA DE ESTADOS DE CUOTAS — 7 reglas
══════════════════════════════════════════════════ */
function resolverEstadoCobro(c) {
    /* ──────────────────────────────────────────────────────
     * Implementa las 7 reglas del sistema de cuotas:
     * Regla 6: A_DEFINIR  → sin monto cargado
     * paso:    PENDIENTE  → comprobante subido, esperando revisión (sin recibo)
     * Regla 2: ABONADA    → recibo final aprobado, saldo = 0
     * Regla 3: PAGO_PARCIAL → recibo parcial, saldo > 0
     * Regla 5: EN_MORA    → venció + sin pago aprobado + sin comp. válido en revisión
     * default: NO_ABONADA → tiene monto, no venció, sin comprobante
     * ────────────────────────────────────────────────────── */
    if (c && c.no_aplica === true) return 'NO_APLICA';               // Cuota excluida
    if (!tieneMontoDefinido(c)) return 'A_DEFINIR';                     // Regla 6

    var estadoDb     = String((c && c.estado) || '').trim().toUpperCase();
    if (estadoDb === 'A_DEFINIR') return 'A_DEFINIR';                   // Regla 6b: estado explícito en BD
    var saldo        = (c && c.saldo_pendiente !== null && c.saldo_pendiente !== undefined && c.saldo_pendiente !== '')
                       ? redondear2(c.saldo_pendiente) : null;
    var montoFinal   = redondear2(c.monto_final);
    var montoAbonado = calcMontoAbonado(c);
    var tieneRecibo  = !!(c && c.recibo_url);
    var tieneComp    = !!(c && c.comprobante_url);

    // PENDIENTE: comprobante subido, esperando revisión cooperadora
    if (estadoDb === 'PENDIENTE' || (tieneComp && !tieneRecibo && montoAbonado <= 0)) return 'PENDIENTE';

    // ABONADA: recibo cargado + saldo = 0, o estado en BD ya es ABONADA con saldo = 0 (datos importados)
    if (saldo !== null && saldo <= 0 && (tieneRecibo || estadoDb === 'ABONADA')) return 'ABONADA';

    // EN_MORA sobre saldo parcial: recibo parcial vencido, saldo en mora, sin nuevo comprobante
    if (estadoDb === 'EN_MORA' && tieneRecibo && saldo !== null && saldo > 0 && montoAbonado > 0 && !tieneComp) return 'EN_MORA';

    // PAGO_PARCIAL: monto abonado con saldo pendiente, con o sin recibo (admin puede aprobar sin recibo)
    if (saldo !== null && saldo > 0 && montoAbonado > 0) return 'PAGO_PARCIAL';

    // EN_MORA: apenas vence sin pago aprobado y sin comprobante válido en revisión (Regla 5)
    // La BD puede tener EN_MORA (ya procesado) o puede ser nueva (recién venció)
    if (estadoDb === 'EN_MORA') return 'EN_MORA';
    if (vencioCuota(c) && montoAbonado <= 0 && !tieneComp) return 'EN_MORA';
    if (vencioCuota(c) && montoAbonado <= 0 && estadoDb !== 'PENDIENTE') return 'EN_MORA';

    return 'NO_ABONADA';
}

/* calcEstadoPostRechazo — Regla 4: rechazar nunca deja en PENDIENTE */
function calcEstadoPostRechazo(c) {
    if (!tieneMontoDefinido(c)) return 'A_DEFINIR';
    var montoAbonado = calcMontoAbonado(c);
    var saldo = redondear2(c.saldo_pendiente || 0);
    if (montoAbonado > 0 && saldo > 0) return vencioCuota(c) ? 'EN_MORA' : 'PAGO_PARCIAL';
    if (vencioCuota(c) && montoAbonado <= 0) return 'EN_MORA';
    return 'NO_ABONADA';
}

function etiquetaEstado(estado) {
    return {
        NO_ABONADA: 'No abonada',
        PENDIENTE: 'Pendiente',
        ABONADA: 'Abonada',
        PAGO_PARCIAL: 'Pago parcial',
        EN_MORA: 'En mora',
        A_DEFINIR: 'A definir'
    }[estado] || estado || '—';
}

function pesoEstado(estado) {
    return { EN_MORA: 6, PENDIENTE: 5, PAGO_PARCIAL: 4, NO_ABONADA: 3, A_DEFINIR: 2, ABONADA: 1, NO_APLICA: 0 }[estado] || 0;
}

function normalizarEstadoCuota(montoFinal, saldoPendiente, fechaVencimiento, estadoActual) {
    var mock = {
        monto_final: montoFinal,
        saldo_pendiente: saldoPendiente,
        fecha_vencimiento: fechaVencimiento,
        estado: estadoActual || '',
        recibo_url: ''
    };
    return resolverEstadoCobro(mock);
}

/* Estado general (peor estado) de un conjunto de cuotas de un estudiante */
function calcEstadoGeneral(cobros) {
    if (!cobros || cobros.length === 0) return 'A_DEFINIR';
    var peor = 'ABONADA';
    cobros.forEach(function(c) {
        var est = resolverEstadoCobro(c);
        if (pesoEstado(est) > pesoEstado(peor)) peor = est;
    });
    return peor;
}

/* ══════════════════════════════════════════════════
   MORA — recálculo del recargo vía RPC del servidor.
   El interés compuesto se calcula en la BD (aplicar_mora_cohorte_impl)
   para que el resultado sea idéntico en todas las vistas y en pg_cron.
══════════════════════════════════════════════════ */
async function aplicarMoraCohorteJS(cohorteId) {
    var sb = await getSupabase();
    await sb.rpc('aplicar_mora_cohorte', { p_cohorte_id: cohorteId });
}

/* ══════════════════════════════════════════════════
   FILTROS Y PAGINACIÓN DE LA TABLA
   Operan sobre el estado global `V` (V.data.estudiantes, V.filtro, V.page)
   y sobre el DOM estándar de las 4 vistas:
     .filter-btn[data-f]  → chips de filtro
     .fila-est[data-est]  → filas de estudiante (data-readmision opcional)
     #empty               → mensaje "sin resultados"
     #wrap-mas-est / #btn-mas-est → paginación (opcional; profesor no la usa)
   La paginación se autodetecta: si no existe #btn-mas-est, se muestran todas
   las filas (comportamiento de la vista profesor, sin "mostrar más").
══════════════════════════════════════════════════ */
var CT_PAGE_SIZE = 30;

function actualizarFiltros() {
    var ests = (window.V && V.data && V.data.estudiantes) || [];
    var labels = {
        todos: 'Todos', ABONADA: 'Al día', EN_MORA: 'En mora',
        PAGO_PARCIAL: 'Pago parcial', PENDIENTE: 'Pendiente',
        NO_ABONADA: 'No abonada', A_DEFINIR: 'A definir', READMISION: 'Readmisión'
    };
    document.querySelectorAll('.filter-btn').forEach(function(b) {
        var f = b.dataset.f;
        var n;
        if (f === 'todos') n = ests.length;
        else if (f === 'READMISION') n = ests.filter(function(e){ return (e.cobros||[]).some(function(c){ return c && c.es_readmision; }); }).length;
        else n = ests.filter(function(e){ return calcEstadoGeneral(e.cobros) === f; }).length;
        b.textContent = (labels[f] || f) + ' (' + n + ')';
    });
}

function initFiltros() {
    document.querySelectorAll('.filter-btn').forEach(function(b) {
        b.onclick = function() {
            V.filtro = b.dataset.f;
            document.querySelectorAll('.filter-btn').forEach(function(x){ x.classList.remove('active'); });
            b.classList.add('active');
            aplicarFiltro();
        };
    });
}

function aplicarFiltro() {
    V.page = 1;
    _aplicarFiltroYPag();
}

function _aplicarFiltroYPag() {
    var paginar = !!document.getElementById('btn-mas-est');
    var vis = 0, ocultas = 0;
    document.querySelectorAll('.fila-est').forEach(function(tr) {
        var ok = V.filtro === 'todos'
            ? true
            : V.filtro === 'READMISION'
                ? tr.dataset.readmision === '1'
                : tr.dataset.est === V.filtro;
        if (!ok) { tr.classList.add('oculta'); return; }
        vis++;
        var enPag = !paginar || vis <= V.page * CT_PAGE_SIZE;
        tr.classList.toggle('oculta', !enPag);
        if (!enPag) ocultas++;
    });
    var emptyEl = document.getElementById('empty');
    if (emptyEl) emptyEl.classList.toggle('show', vis === 0);
    var wrap = document.getElementById('wrap-mas-est');
    var btn  = document.getElementById('btn-mas-est');
    if (wrap && btn) {
        wrap.style.display = ocultas > 0 ? '' : 'none';
        btn.textContent = 'Mostrar ' + Math.min(ocultas, CT_PAGE_SIZE) + ' más (' + ocultas + ' restantes)';
    }
}

function mostrarMas() {
    V.page++;
    _aplicarFiltroYPag();
}
