/**
 * ══════════════════════════════════════════════════════════════
 * SiGPo — supabase.js
 * Cliente Supabase + funciones de API para todas las vistas
 * ══════════════════════════════════════════════════════════════
 */

const SUPABASE_URL = 'https://fdevypdowdhqaxvfiywt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PxypVbCcQuum2EtxuJRmkg_korPHaCW';

// ══════════════════════════════════════════════════════════════
// INICIALIZAR CLIENTE
// ══════════════════════════════════════════════════════════════

let _supabase = null;

async function getSupabase() {
    if (_supabase) return _supabase;

    if (window.supabase && window.supabase.createClient) {
        _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        return _supabase;
    }

    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });

    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return _supabase;
}

// ══════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ══════════════════════════════════════════════════════════════

async function login(dni, password) {
    const sb = await getSupabase();

    // Primero buscar el email real del usuario por DNI
    const { data: usuarioPre, error: errPre } = await sb
        .from('usuarios')
        .select('rol, apellido, nombre, nombre_completo, email, programa_id, dni, activo')
        .eq('dni', String(dni))
        .single();

    if (errPre || !usuarioPre) {
        return { ok: false, mensaje: 'DNI o contraseña incorrectos' };
    }
    if (!usuarioPre.activo) {
        return { ok: false, mensaje: 'Usuario inactivo' };
    }

    // Login con el email real del usuario
    const { data, error } = await sb.auth.signInWithPassword({
        email: usuarioPre.email,
        password: password
    });

    if (error) {
        return { ok: false, mensaje: 'DNI o contraseña incorrectos' };
    }

    const usuario = usuarioPre;

    localStorage.setItem('sigpo_rol', usuario.rol);
    localStorage.setItem('sigpo_nombre', usuario.nombre_completo);
    localStorage.setItem('sigpo_apellido', usuario.apellido || '');
    localStorage.setItem('sigpo_nombre2', usuario.nombre || '');
    localStorage.setItem('sigpo_dni', usuario.dni);
    localStorage.setItem('sigpo_email', usuario.email);
    localStorage.setItem('sigpo_programa_id', usuario.programa_id || '');

    return {
        ok: true,
        rol: usuario.rol,
        nombre: usuario.nombre_completo,
        email: usuario.email
    };
}

async function logout() {
    const sb = await getSupabase();
    await sb.auth.signOut();
    localStorage.removeItem('sigpo_rol');
    localStorage.removeItem('sigpo_nombre');
    localStorage.removeItem('sigpo_apellido');
    localStorage.removeItem('sigpo_nombre2');
    localStorage.removeItem('sigpo_dni');
    localStorage.removeItem('sigpo_email');
    localStorage.removeItem('sigpo_programa_id');
    return { ok: true };
}

function getSesion() {
    const rol = localStorage.getItem('sigpo_rol');
    if (!rol) return null;
    return {
        rol: rol,
        nombre: localStorage.getItem('sigpo_nombre'),
        dni: localStorage.getItem('sigpo_dni'),
        email: localStorage.getItem('sigpo_email'),
        programa_id: localStorage.getItem('sigpo_programa_id')
    };
}

async function requireAuth() {
    const sb = await getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.href = 'portal_login.html';
        return null;
    }
    return getSesion();
}

async function recuperarPassword(dni) {
    const sb = await getSupabase();
    const { data: usuario } = await sb
        .from('usuarios')
        .select('email')
        .eq('dni', dni)
        .single();

    if (!usuario) return { ok: false };

    const { error } = await sb.auth.resetPasswordForEmail(usuario.email);
    if (error) return { ok: false };

    const email = usuario.email;
    const partes = email.split('@');
    const oculto = partes[0].substring(0, 3) + '***@' + partes[1];
    return { ok: true, email: oculto };
}

// ══════════════════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════════════════

function navegar(pagina) {
    window.location.href = pagina;
}

function cerrarSesion(e) {
    if (e) e.preventDefault();
    if (!confirm('¿Querés cerrar la sesión?')) return false;
    logout().then(function () {
        window.location.href = 'portal_login.html';
    });
    return false;
}

const RUTAS_POR_ROL = {
    'ESTUDIANTE':    'portal_estudiante_2_dashboard.html',
    'COORDINADOR':   'coordinador_1_dashboard.html',
    'SECRETARIA':    'secretaria_1_dashboard.html',
    'COOPERADORA':   'cooperadora_2_Dashboard.html',
    'ADMINISTRADOR': 'administrador_2_dashboard.html'
};

// ══════════════════════════════════════════════════════════════
// TAXONOMÍA: PROGRAMAS vs CURSOS
// Programas (posgrado): DOCTORADO, MAESTRIA, ESPECIALIZACION → Cohorte
// Cursos: DIPLOMADO, DIPLOMATURA, CURSO, MICRO_MAESTRIA     → Edición
// ══════════════════════════════════════════════════════════════

var TIPOS_PROGRAMA = ['DOCTORADO', 'MAESTRIA', 'ESPECIALIZACION'];
var TIPOS_CURSO    = ['DIPLOMADO', 'DIPLOMATURA', 'CURSO', 'MICRO_MAESTRIA'];

function getCategoriaPrograma(tipo) {
    if (!tipo) return 'Programa';
    return TIPOS_PROGRAMA.indexOf((tipo || '').toUpperCase()) >= 0 ? 'Programa' : 'Curso';
}

function getLabelNomenclatura(tipo) {
    return getCategoriaPrograma(tipo) === 'Programa' ? 'Cohorte' : 'Edición';
}

function getLabelNomenclaturaPlural(tipo) {
    return getCategoriaPrograma(tipo) === 'Programa' ? 'Cohortes' : 'Ediciones';
}

function getIconoTipo(tipo) {
    var t = (tipo || '').toUpperCase();
    var iconos = {
        'DOCTORADO':      '🎓',
        'MAESTRIA':       '📊',
        'ESPECIALIZACION':'💼',
        'DIPLOMADO':      '🏅',
        'DIPLOMATURA':    '📜',
        'CURSO':          '📖',
        'MICRO_MAESTRIA': '🔬'
    };
    return iconos[t] || '📚';
}

// ══════════════════════════════════════════════════════════════
// ESTADOS ACADÉMICOS — constantes centralizadas
// El enum en la BD tiene: ACTIVO, BAJA
// ══════════════════════════════════════════════════════════════
var ESTADO_ACTIVO = 'ACTIVO';
var ESTADO_BAJA   = 'BAJA';

// ══════════════════════════════════════════════════════════════
// NOTIFICACIONES
// ══════════════════════════════════════════════════════════════

var _notifs = [];

async function obtenerNotificaciones(rol) {
    const sb = await getSupabase();
    const sesion = getSesion();
    if (!sesion) return [];

    const { data, error } = await sb
        .from('notificaciones')
        .select('*')
        .or('usuario_dni.eq.' + sesion.dni + ',rol_destino.eq.' + rol)
        .order('created_at', { ascending: false })
        .limit(20);

    return error ? [] : (data || []).map(function (n) {
        return {
            id: String(n.id),
            tipo: n.tipo,
            mensaje: n.mensaje,
            tiempo: tiempoRelativo(n.created_at),
            leida: n.leida
        };
    });
}

async function marcarNotificacionLeida(id) {
    const sb = await getSupabase();
    await sb.from('notificaciones').update({ leida: true }).eq('id', id);
}

async function marcarTodasNotificacionesLeidas() {
    const sb = await getSupabase();
    const sesion = getSesion();
    if (!sesion) return;
    await sb.from('notificaciones')
        .update({ leida: true })
        .eq('usuario_dni', sesion.dni)
        .eq('leida', false);
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD) a DD/MM/YYYY
 * Usada en todos los HTML del sistema
 */
function fFecha(fecha) {
    if (!fecha) return '—';
    var partes = String(fecha).split('T')[0].split('-');
    if (partes.length !== 3) return fecha;
    return partes[2] + '/' + partes[1] + '/' + partes[0];
}

function tiempoRelativo(fecha) {
    var ahora = new Date();
    var diff = ahora - new Date(fecha);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Ahora';
    if (mins < 60) return 'Hace ' + mins + ' min';
    var horas = Math.floor(mins / 60);
    if (horas < 24) return 'Hace ' + horas + (horas === 1 ? ' hora' : ' horas');
    var dias = Math.floor(horas / 24);
    if (dias < 7) return 'Hace ' + dias + (dias === 1 ? ' día' : ' días');
    return new Date(fecha).toLocaleDateString('es-AR');
}

function toggleNotif() {
    var dd = document.getElementById('notif-dropdown');
    if (!dd) return;
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
}

function renderNotificaciones(datos) {
    _notifs = datos || [];
    var sinLeer = _notifs.filter(function (n) { return !n.leida; }).length;
    var badge = document.getElementById('notif-badge');
    if (badge) {
        badge.textContent = sinLeer;
        badge.style.display = sinLeer > 0 ? 'flex' : 'none';
    }
    var lista = document.getElementById('notif-list');
    if (!lista) return;
    if (_notifs.length === 0) {
        lista.innerHTML = '<div style="padding:32px 20px;text-align:center;color:#9ca3af;font-size:14px;">No hay notificaciones</div>';
        return;
    }
    var iconos = { pago: '💰', mora: '🔴', solicitud: '📋', reclamo: '⚠️', alerta: '🚨', cuota: '📅' };
    var colores = { pago: '#dcfce7', mora: '#fee2e2', solicitud: '#dbeafe', reclamo: '#fef3c7', alerta: '#fce7f3', cuota: '#dbeafe' };
    lista.innerHTML = _notifs.map(function (n) {
        return '<div style="display:flex;gap:12px;padding:14px 20px;border-bottom:1px solid #f3f4f6;cursor:pointer;background:' + (n.leida ? '#fff' : '#fffbeb') + ';" onclick="leerNotif(\'' + n.id + '\')">'
            + '<div style="width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;background:' + (colores[n.tipo] || '#f3f4f6') + ';">' + (iconos[n.tipo] || '🔔') + '</div>'
            + '<div style="flex:1;"><p style="font-size:13px;color:#374151;line-height:1.4;">' + n.mensaje + '</p><div style="font-size:11px;color:#9ca3af;margin-top:3px;">' + (n.tiempo || '') + '</div></div></div>';
    }).join('');
}

function leerNotif(id) {
    _notifs.forEach(function (n) { if (n.id === id) n.leida = true; });
    renderNotificaciones(_notifs);
    marcarNotificacionLeida(id);
}

document.addEventListener('click', function (e) {
    var w = document.querySelector('.notif-wrapper');
    if (w && !w.contains(e.target)) {
        var dd = document.getElementById('notif-dropdown');
        if (dd) dd.style.display = 'none';
    }
});

// ══════════════════════════════════════════════════════════════
// PROGRAMAS
// ══════════════════════════════════════════════════════════════

async function obtenerProgramas() {
    const sb = await getSupabase();
    const { data } = await sb.from('programas').select('*').order('nombre');
    return data || [];
}

async function obtenerCohortes(programaId) {
    const sb = await getSupabase();
    let query = sb.from('cohortes').select('*').order('fecha_inicio', { ascending: false });
    if (programaId) query = query.eq('programa_id', programaId);
    const { data } = await query;
    return data || [];
}

/**
 * Obtener estudiantes de una cohorte.
 * CAMBIO: ahora usa la tabla inscripciones (N:N) en vez de
 * los campos directos estudiantes.programa_id / cohorte_id
 */
async function obtenerEstudiantes(programaId, cohorteId) {
    const sb = await getSupabase();

    if (cohorteId) {
        // Obtener IDs de estudiantes inscritos en esta cohorte
        const { data: insc } = await sb
            .from('inscripciones')
            .select('estudiante_id, descuento_porcentaje, estado_academico, fecha_inscripcion')
            .eq('cohorte_id', cohorteId);

        if (!insc || !insc.length) return [];

        const ids = insc.map(function(i) { return i.estudiante_id; });
        const { data: ests } = await sb
            .from('estudiantes')
            .select('*')
            .in('id', ids)
            .order('apellido');

        // Fusionar datos de inscripción en cada estudiante
        const inscMap = {};
        insc.forEach(function(i) { inscMap[i.estudiante_id] = i; });

        return (ests || []).map(function(e) {
            var i = inscMap[e.id] || {};
            return Object.assign({}, e, {
                descuento_porcentaje: i.descuento_porcentaje !== undefined ? i.descuento_porcentaje : e.descuento_porcentaje,
                estado_academico:     i.estado_academico || e.estado_academico,
                cohorte_id:           cohorteId,
                inscripcion_id:       i.id || null
            });
        });
    }

    if (programaId) {
        // Cohortes del programa → inscripciones → estudiantes
        const { data: cohs } = await sb
            .from('cohortes')
            .select('cohorte_id')
            .eq('programa_id', programaId);
        if (!cohs || !cohs.length) return [];

        const cohIds = cohs.map(function(c) { return c.cohorte_id; });
        const { data: insc } = await sb
            .from('inscripciones')
            .select('estudiante_id')
            .in('cohorte_id', cohIds);
        if (!insc || !insc.length) return [];

        const ids = [...new Set(insc.map(function(i) { return i.estudiante_id; }))];
        const { data: ests } = await sb
            .from('estudiantes')
            .select('*')
            .in('id', ids)
            .order('apellido');
        return ests || [];
    }

    // Sin filtros: todos
    const { data } = await sb.from('estudiantes').select('*').order('apellido');
    return data || [];
}

/**
 * Detalle de programa con sus cohortes y estadísticas.
 * CAMBIO: cuenta estudiantes por cohorte via inscripciones
 */
async function obtenerDetallePrograma(programaId) {
    const sb = await getSupabase();
    const [progRes, cohRes, cobRes, egrRes] = await Promise.all([
        sb.from('programas').select('*').eq('programa_id', programaId).single(),
        sb.from('cohortes').select('*').eq('programa_id', programaId).order('fecha_inicio', { ascending: false }),
        sb.from('cobros').select('cobro_id,dni,cohorte_id,estado,monto_final,saldo_pendiente').eq('programa_id', programaId),
        sb.from('egresos').select('egreso_id,cohorte_id,monto_pagado').eq('programa_id', programaId)
    ]);

    var prog = progRes.data;
    if (!prog) return null;

    var cohortes = cohRes.data || [];
    var cobros   = cobRes.data || [];
    var egresos  = egrRes.data || [];

    // Contar estudiantes por cohorte via inscripciones
    var cohIds = cohortes.map(function(c) { return c.cohorte_id; });
    var inscRes = cohIds.length
        ? await sb.from('inscripciones').select('cohorte_id, estado_academico').in('cohorte_id', cohIds)
        : { data: [] };
    var inscripciones = inscRes.data || [];

    return {
        id:     prog.programa_id,
        nombre: prog.nombre,
        tipo:   prog.tipo,
        cohortes: cohortes.map(function(coh) {
            var inscCoh    = inscripciones.filter(function(i) { return i.cohorte_id === coh.cohorte_id; });
            var cobrosCoh  = cobros.filter(function(c) { return c.cohorte_id === coh.cohorte_id; });
            var egresosCoh = egresos.filter(function(e) { return e.cohorte_id === coh.cohorte_id; });

            // DNIs únicos con mora en esta cohorte
            var dnisConMora = new Set(
                cobrosCoh.filter(function(c) { return c.estado === 'EN_MORA'; }).map(function(c) { return c.dni; })
            );
            var totalEst = inscCoh.length;
            var enMora   = dnisConMora.size;
            var alDia    = Math.max(0, totalEst - enMora);

            var recaudado = cobrosCoh.reduce(function(s, c) {
                return s + Math.max(0, (Number(c.monto_final || 0) - Number(c.saldo_pendiente || 0)));
            }, 0);
            var egresosMonto = egresosCoh.filter(function(e){ return e.tipo === 'EJECUTADO'; }).reduce(function(s, e) {
                return s + Number(e.monto_pagado || 0);
            }, 0);

            return {
                id: coh.cohorte_id, nombre: coh.nombre, estado: coh.estado,
                fechaInicio: coh.fecha_inicio, fechaFin: coh.fecha_fin,
                estudiantes: totalEst, alDia: alDia, enMora: enMora,
                recaudado: recaudado, egresos: egresosMonto, saldo: recaudado - egresosMonto
            };
        })
    };
}

// ══════════════════════════════════════════════════════════════
// COBROS (CUOTAS)
// ══════════════════════════════════════════════════════════════

async function obtenerCobros(filtros) {
    const sb = await getSupabase();
    let query = sb.from('cobros').select('*');
    if (filtros) {
        if (filtros.dni)         query = query.eq('dni', filtros.dni);
        if (filtros.programa_id) query = query.eq('programa_id', filtros.programa_id);
        if (filtros.cohorte_id)  query = query.eq('cohorte_id', filtros.cohorte_id);
        if (filtros.estado)      query = query.eq('estado', filtros.estado);
    }
    const { data } = await query.order('fecha_vencimiento');
    return data || [];
}

async function subirComprobante(cobroId, file) {
    const sb = await getSupabase();
    const sesion = getSesion();
    if (!sesion) return { ok: false };

    const fileName = sesion.dni + '/' + Date.now() + '_' + file.name;
    const { data: uploadData, error: uploadErr } = await sb.storage
        .from('comprobantes')
        .upload(fileName, file);

    if (uploadErr) return { ok: false, mensaje: 'Error al subir archivo: ' + uploadErr.message };

    const { data: urlData } = sb.storage.from('comprobantes').getPublicUrl(fileName);

    const { error: updateErr } = await sb.from('cobros').update({
        estado: 'PENDIENTE',
        comprobante_url: urlData.publicUrl,
        comprobante_fecha: new Date().toISOString()
    }).eq('cobro_id', cobroId);

    if (updateErr) return { ok: false, mensaje: 'Error al actualizar cobro' };
    return { ok: true, url: urlData.publicUrl };
}

async function aprobarPago(cobroId, tipo, montoAprobado, reciboFile) {
    const sb = await getSupabase();

    let reciboUrl = null;
    if (reciboFile) {
        const fileName = 'recibos/' + cobroId + '/' + Date.now() + '_' + reciboFile.name;
        const { error: uploadErr } = await sb.storage.from('comprobantes').upload(fileName, reciboFile);
        if (uploadErr) return { ok: false, mensaje: 'Error al subir recibo' };
        const { data: urlData } = sb.storage.from('comprobantes').getPublicUrl(fileName);
        reciboUrl = urlData.publicUrl;
    }

    if (!reciboUrl) return { ok: false, mensaje: 'Sin recibo, no se puede aprobar (Regla 1)' };

    const { data: cobro } = await sb.from('cobros').select('*').eq('cobro_id', cobroId).single();
    if (!cobro) return { ok: false, mensaje: 'Cobro no encontrado' };

    if (tipo === 'COMPLETO') {
        await sb.from('cobros').update({
            estado: 'ABONADA',
            saldo_pendiente: 0,
            fecha_pago: new Date().toISOString().split('T')[0],
            recibo_url: reciboUrl
        }).eq('cobro_id', cobroId);
    } else {
        var nuevoSaldo = cobro.monto_final - montoAprobado;
        await sb.from('cobros').update({
            estado: 'PAGO_PARCIAL',
            saldo_pendiente: nuevoSaldo,
            recibo_url: reciboUrl
        }).eq('cobro_id', cobroId);

        await sb.from('pagos').insert({
            cobro_id: cobroId,
            monto: montoAprobado,
            fecha_pago: new Date().toISOString().split('T')[0],
            recibo_url: reciboUrl
        });
    }

    return { ok: true };
}

async function rechazarPago(cobroId) {
    const sb = await getSupabase();

    const { data: cobro } = await sb.from('cobros').select('*').eq('cobro_id', cobroId).single();
    if (!cobro) return { ok: false };

    var nuevoEstado = 'NO_ABONADA';

    if (!cobro.monto_final || cobro.monto_final === 0) {
        nuevoEstado = 'A_DEFINIR';
    } else if (cobro.fecha_vencimiento && new Date(cobro.fecha_vencimiento) < new Date()) {
        nuevoEstado = 'EN_MORA';
    } else {
        const { data: pagos } = await sb.from('pagos').select('monto').eq('cobro_id', cobroId);
        var totalPagado = (pagos || []).reduce(function (s, p) { return s + Number(p.monto); }, 0);
        nuevoEstado = totalPagado > 0 ? 'PAGO_PARCIAL' : 'NO_ABONADA';
    }

    await sb.from('cobros').update({
        estado: nuevoEstado,
        comprobante_url: null,
        comprobante_fecha: null
    }).eq('cobro_id', cobroId);

    return { ok: true, nuevoEstado: nuevoEstado };
}

// ══════════════════════════════════════════════════════════════
// INSCRIPCIONES — alta/baja de estudiante en una cohorte
// CAMBIO: ya no toca estudiantes.estado_academico sino inscripciones
// ══════════════════════════════════════════════════════════════

/**
 * Cambiar estado académico de un estudiante EN UNA COHORTE específica.
 * nuevoEstado debe ser 'ACTIVO' o 'BAJA' (valores del enum en la BD).
 */
async function cambiarEstadoInscripcion(estudianteId, cohorteId, nuevoEstado) {
    const sb = await getSupabase();
    const { error } = await sb
        .from('inscripciones')
        .update({ estado_academico: nuevoEstado })
        .eq('estudiante_id', estudianteId)
        .eq('cohorte_id', cohorteId);
    return { ok: !error, error: error };
}

/**
 * Obtener el estado académico de un estudiante en una cohorte concreta.
 */
async function getEstadoInscripcion(estudianteId, cohorteId) {
    const sb = await getSupabase();
    const { data } = await sb
        .from('inscripciones')
        .select('estado_academico, descuento_porcentaje, id')
        .eq('estudiante_id', estudianteId)
        .eq('cohorte_id', cohorteId)
        .single();
    return data || null;
}

// ══════════════════════════════════════════════════════════════
// EGRESOS
// ══════════════════════════════════════════════════════════════

async function obtenerEgresos(filtros) {
    const sb = await getSupabase();
    let query = sb.from('egresos').select('*');
    if (filtros) {
        if (filtros.programa_id) query = query.eq('programa_id', filtros.programa_id);
        if (filtros.cohorte_id)  query = query.eq('cohorte_id', filtros.cohorte_id);
        if (filtros.tipo)        query = query.eq('tipo', filtros.tipo);
    }
    const { data } = await query.order('fecha_estimada');
    return data || [];
}

async function guardarEgreso(datos) {
    const sb = await getSupabase();
    if (datos.egreso_id) {
        const { error } = await sb.from('egresos').update(datos).eq('egreso_id', datos.egreso_id);
        return { ok: !error };
    } else {
        const { error } = await sb.from('egresos').insert(datos);
        return { ok: !error };
    }
}

async function eliminarEgreso(egresoId) {
    const sb = await getSupabase();
    const { error } = await sb.from('egresos').delete().eq('egreso_id', egresoId);
    return { ok: !error };
}

// ══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════

async function obtenerConfiguracion() {
    const sb = await getSupabase();
    const { data } = await sb.from('configuracion').select('*');
    var result = {};
    (data || []).forEach(function (row) { result[row.clave] = row.valor; });
    return result;
}

async function guardarConfiguracion(datos) {
    const sb = await getSupabase();
    for (var clave in datos) {
        await sb.from('configuracion').upsert({ clave: clave, valor: String(datos[clave]) }, { onConflict: 'clave' });
    }
    return { ok: true };
}

// ══════════════════════════════════════════════════════════════
// CATEGORÍAS DE GASTOS
// ══════════════════════════════════════════════════════════════

async function obtenerCategoriasGastos() {
    const sb = await getSupabase();
    const { data } = await sb.from('categorias_gastos').select('*').order('id');
    return data || [];
}

async function guardarCategoriasGastos(cambios) {
    const sb = await getSupabase();
    for (var i = 0; i < cambios.length; i++) {
        await sb.from('categorias_gastos').update({ tipo: cambios[i].tipoNuevo }).eq('id', cambios[i].id);
    }
    return { ok: true };
}

// ══════════════════════════════════════════════════════════════
// USUARIOS
// ══════════════════════════════════════════════════════════════

async function obtenerUsuarios() {
    const sb = await getSupabase();
    const { data } = await sb.from('usuarios').select('*').order('nombre_completo');
    return data || [];
}

/**
 * Obtener programas asignados a un coordinador (via coordinadores_programas)
 */
async function obtenerProgramasCoordinador(usuarioId) {
    const sb = await getSupabase();
    const { data } = await sb
        .from('coordinadores_programas')
        .select('programa_id, programas(nombre, tipo)')
        .eq('coordinador_id', usuarioId);
    return data || [];
}

/**
 * Asignar programas a un coordinador (reemplaza los existentes)
 */
async function asignarProgramasCoordinador(usuarioId, programaIds) {
    const sb = await getSupabase();
    // Borrar asignaciones previas
    await sb.from('coordinadores_programas').delete().eq('coordinador_id', usuarioId);
    if (!programaIds || !programaIds.length) return { ok: true };
    // Insertar nuevas
    const rows = programaIds.map(function(pid) {
        return { coordinador_id: usuarioId, programa_id: pid };
    });
    const { error } = await sb.from('coordinadores_programas').insert(rows);
    return { ok: !error };
}

async function guardarUsuario(datos) {
    const sb = await getSupabase();
    if (datos.usuario_id) {
        const { error } = await sb.from('usuarios').update(datos).eq('usuario_id', datos.usuario_id);
        return { ok: !error };
    } else {
        const { error } = await sb.from('usuarios').insert(datos);
        return { ok: !error };
    }
}

async function darDeBaja(usuarioId) {
    const sb = await getSupabase();
    const { error } = await sb.from('usuarios').update({ activo: false }).eq('usuario_id', usuarioId);
    return { ok: !error };
}

async function darDeAlta(usuarioId) {
    const sb = await getSupabase();
    const { error } = await sb.from('usuarios').update({ activo: true }).eq('usuario_id', usuarioId);
    return { ok: !error };
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD ADMIN
// CAMBIO: cuenta estudiantes via inscripciones, no via programa_id directo
// ══════════════════════════════════════════════════════════════

async function obtenerDashboardAdmin() {
    const sb = await getSupabase();

    const [progRes, cohRes, cobRes, egrRes, inscRes] = await Promise.all([
        sb.from('programas').select('*'),
        sb.from('cohortes').select('*'),
        sb.from('cobros').select('cobro_id,dni,programa_id,cohorte_id,estado,monto_final,saldo_pendiente'),
        sb.from('egresos').select('egreso_id,programa_id,cohorte_id,monto_pagado'),
        sb.from('inscripciones').select('id,estudiante_id,cohorte_id,estado_academico')
    ]);

    var programas     = progRes.data || [];
    var cohortes      = cohRes.data || [];
    var cobros        = cobRes.data || [];
    var egresos       = egrRes.data || [];
    var inscripciones = inscRes.data || [];

    // IDs de estudiantes activos (via inscripciones activas)
    var inscActivas = inscripciones.filter(function(i) { return i.estado_academico === ESTADO_ACTIVO; });
    var estIdsActivos = new Set(inscActivas.map(function(i) { return i.estudiante_id; }));
    var totalEstActivos = estIdsActivos.size;

    // Construir mapa: cohorte_id → programa_id
    var cohProgMap = {};
    cohortes.forEach(function(c) { cohProgMap[c.cohorte_id] = c.programa_id; });

    var totalRecaudado = cobros.reduce(function (s, c) {
        return s + Math.max(0, (Number(c.monto_final || 0) - Number(c.saldo_pendiente || 0)));
    }, 0);
    var totalEgresos = egresos.filter(function(e){ return e.tipo === 'EJECUTADO'; }).reduce(function (s, e) { return s + Number(e.monto_pagado || 0); }, 0);

    // Estudiantes en mora: tienen al menos 1 cobro EN_MORA
    var dnisConMora = new Set(
        cobros.filter(function(c) { return c.estado === 'EN_MORA'; }).map(function(c) { return c.dni; })
    );

    var totalProgramasPosgrado = programas.filter(function(p) { return getCategoriaPrograma(p.tipo) === 'Programa'; }).length;
    var totalCursos            = programas.filter(function(p) { return getCategoriaPrograma(p.tipo) === 'Curso'; }).length;

    return {
        totalProgramas:          programas.length,
        totalProgramasPosgrado:  totalProgramasPosgrado,
        totalCursos:             totalCursos,
        estudiantesActivos:      totalEstActivos,
        alDia:                   totalEstActivos - dnisConMora.size,
        enMora:                  dnisConMora.size,
        recaudado:               totalRecaudado,
        egresos:                 totalEgresos,
        saldo:                   totalRecaudado - totalEgresos,
        programas: programas.map(function (p) {
            // Cohortes del programa
            var cohsProg = cohortes.filter(function(c) { return c.programa_id === p.programa_id; });
            var cohIdsProg = cohsProg.map(function(c) { return c.cohorte_id; });

            // Inscripciones en esas cohortes
            var inscProg = inscripciones.filter(function(i) { return cohIdsProg.indexOf(i.cohorte_id) >= 0; });
            var estIdsProg = new Set(inscProg.map(function(i) { return i.estudiante_id; }));

            var cobrosProg  = cobros.filter(function(c) { return c.programa_id === p.programa_id; });
            var egresosProg = egresos.filter(function(e) { return e.programa_id === p.programa_id; });

            var dnisConMoraProg = new Set(
                cobrosProg.filter(function(c) { return c.estado === 'EN_MORA'; }).map(function(c) { return c.dni; })
            );

            var recaudadoProg = cobrosProg.reduce(function (s, c) {
                return s + Math.max(0, (Number(c.monto_final || 0) - Number(c.saldo_pendiente || 0)));
            }, 0);
            var egresosPagadosProg = egresosProg.filter(function(e){ return e.tipo === 'EJECUTADO'; }).reduce(function (s, e) {
                return s + Number(e.monto_pagado || 0);
            }, 0);

            var totalEstProg = estIdsProg.size;
            var enMoraProg   = dnisConMoraProg.size;

            return {
                id:               p.programa_id,
                nombre:           p.nombre,
                tipo:             p.tipo,
                categoria:        getCategoriaPrograma(p.tipo),
                labelNomenclatura: getLabelNomenclaturaPlural(p.tipo),
                estudiantes:      totalEstProg,
                cohortes:         cohsProg.length,
                alDia:            Math.max(0, totalEstProg - enMoraProg),
                enMora:           enMoraProg,
                recaudado:        recaudadoProg,
                egresos:          egresosPagadosProg,
                saldo:            recaudadoProg - egresosPagadosProg
            };
        })
    };
}

// ══════════════════════════════════════════════════════════════
// FACTURACIÓN (ESTUDIANTE)
// ══════════════════════════════════════════════════════════════

async function guardarDatosFacturacion(datos) {
    console.log('Datos facturación:', datos);
    return { ok: true };
}

// ══════════════════════════════════════════════════════════════
// PERFIL DE USUARIO
// ══════════════════════════════════════════════════════════════

async function obtenerPerfilUsuario() {
    var sesion = getSesion();
    if (!sesion) return null;
    const sb = await getSupabase();
    // Traer apellido y nombre directamente de la BD
    var r = await sb.from('usuarios').select('apellido, nombre, nombre_completo, dni, email, rol').eq('dni', sesion.dni).single();
    if (!r.data) return null;
    return {
        apellido: r.data.apellido || r.data.nombre_completo || '',
        nombre:   r.data.nombre  || '',
        dni:      r.data.dni,
        email:    r.data.email,
        rol:      r.data.rol
    };
}

// ══════════════════════════════════════════════════════════════
// INICIALIZACIÓN AUTOMÁTICA DE NOTIFICACIONES
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async function () {
    var sesion = getSesion();
    if (sesion && document.getElementById('notif-badge')) {
        var notifs = await obtenerNotificaciones(sesion.rol);
        renderNotificaciones(notifs);
    }
});

// ══════════════════════════════════════════════════════════════
// POLYFILL: google.script.run → Supabase
// Intercepta las llamadas antiguas de GAS y las redirige a Supabase
// ══════════════════════════════════════════════════════════════

var _gasFunctions = {
    // Auth
    login:                    login,
    logout:                   logout,
    getSesion:                getSesion,
    recuperarPassword:        recuperarPassword,
    obtenerPerfilUsuario:     obtenerPerfilUsuario,

    // Notificaciones
    obtenerNotificaciones:                      obtenerNotificaciones,
    marcarNotificacionLeida:                    marcarNotificacionLeida,
    marcarTodasNotificacionesLeidas:            marcarTodasNotificacionesLeidas,
    obtenerNotificacionesCoordinador:           function() { return obtenerNotificaciones('COORDINADOR'); },
    marcarNotificacionesCooperadoraLeidas:      marcarTodasNotificacionesLeidas,
    marcarNotificacionesCoordinadorLeidas:      marcarTodasNotificacionesLeidas,

    // Dashboard
    obtenerDashboardAdmin:       obtenerDashboardAdmin,
    obtenerDashboardCoordinador: async function() { return obtenerDashboardAdmin(); },

    // Programas / Cohortes
    obtenerDetallePrograma: obtenerDetallePrograma,
    getProgramas:           obtenerProgramas,
    cambiarEstadoCohorte:   async function(id, estado) {
        var sb = await getSupabase();
        var r = await sb.from('cohortes').update({ estado: estado }).eq('cohorte_id', id);
        return { ok: !r.error };
    },

    // Inscripciones / estado académico por cohorte
    cambiarEstadoInscripcion: cambiarEstadoInscripcion,
    getEstadoInscripcion:     getEstadoInscripcion,

    // Cobros
    subirComprobante: subirComprobante,
    obtenerUrlComprobante: async function(cobroId) {
        var sb = await getSupabase();
        var r = await sb.from('cobros').select('comprobante_url').eq('cobro_id', cobroId).single();
        return r.data ? r.data.comprobante_url : null;
    },

    // Configuración
    obtenerConfiguracion:    obtenerConfiguracion,
    guardarConfiguracion:    guardarConfiguracion,
    obtenerCategoriasGastos: obtenerCategoriasGastos,
    guardarCategoriasGastos: guardarCategoriasGastos,

    // Usuarios
    guardarUsuario:                 guardarUsuario,
    darDeBaja:                      darDeBaja,
    darDeAlta:                      darDeAlta,
    eliminarUsuario:                async function(id) { return darDeBaja(id); },
    obtenerProgramasCoordinador:    obtenerProgramasCoordinador,
    asignarProgramasCoordinador:    asignarProgramasCoordinador,
    eliminarRegistroCompleto:       async function(id) {
        var sb = await getSupabase();
        await sb.from('usuarios').delete().eq('usuario_id', id);
        return { ok: true };
    },
    getUsuario: async function(id) {
        var sb = await getSupabase();
        var r = await sb.from('usuarios').select('*').eq('usuario_id', id).single();
        return r.data;
    },

    // Facturación
    guardarDatosFacturacion: guardarDatosFacturacion,

    // Reportes / Exportaciones (en desarrollo)
    getDatosComparativo:              async function() { return { periodos: [], datos: [] }; },
    exportarCashflow:                 async function() { alert('Exportación en desarrollo'); return null; },
    exportarReporteExcel:             async function() { alert('Exportación en desarrollo'); return null; },
    exportarEstadoPagosExcel:         async function() { alert('Exportación en desarrollo'); return null; },
    exportarEstadoPagosPDF:           async function() { alert('Exportación en desarrollo'); return null; },
    exportarDesercionExcel:           async function() { alert('Exportación en desarrollo'); return null; },
    exportarDesercionPDF:             async function() { alert('Exportación en desarrollo'); return null; },
    exportarImpactoDescuentosExcel:   async function() { alert('Exportación en desarrollo'); return null; },
    exportarImpactoDescuentosPDF:     async function() { alert('Exportación en desarrollo'); return null; },
    exportarComparativoExcel:         async function() { alert('Exportación en desarrollo'); return null; },
    exportarComparativoPDF:           async function() { alert('Exportación en desarrollo'); return null; },
    exportarLogsExcel:                async function() { alert('Exportación en desarrollo'); return null; },

    // Coordinador
    enviarSolicitudProgramaCurso: async function(datos) {
        console.log('Solicitud programa:', datos);
        return { ok: true };
    },

    // Cooperadora - aprobar pagos
    obtenerListadoAprobarPagosCooperadora: async function(programaId, cohorteId) {
        var sb = await getSupabase();
        var query = sb.from('cobros').select('*');
        if (programaId) query = query.eq('programa_id', programaId);
        if (cohorteId)  query = query.eq('cohorte_id', cohorteId);
        var r = await query.order('fecha_vencimiento');
        return r.data || [];
    }
};

// Proxy para interceptar google.script.run
window.google = window.google || {};
window.google.script = window.google.script || {};
window.google.script.run = new Proxy({}, {
    get: function(target, prop) {
        if (prop === 'withSuccessHandler') {
            return function(successFn) {
                return new Proxy({}, {
                    get: function(t2, prop2) {
                        if (prop2 === 'withFailureHandler') {
                            return function(failFn) {
                                return new Proxy({}, {
                                    get: function(t3, prop3) {
                                        return function() {
                                            var args = Array.from(arguments);
                                            var fn = _gasFunctions[prop3];
                                            if (fn) {
                                                Promise.resolve(fn.apply(null, args))
                                                    .then(successFn).catch(failFn);
                                            } else {
                                                console.warn('GAS polyfill: función no encontrada:', prop3);
                                                failFn(new Error('Función no implementada: ' + prop3));
                                            }
                                        };
                                    }
                                });
                            };
                        }
                        return function() {
                            var args = Array.from(arguments);
                            var fn = _gasFunctions[prop2];
                            if (fn) {
                                Promise.resolve(fn.apply(null, args))
                                    .then(successFn)
                                    .catch(function(e) { console.error('GAS polyfill error:', prop2, e); });
                            } else {
                                console.warn('GAS polyfill: función no encontrada:', prop2);
                            }
                        };
                    }
                });
            };
        }
        if (prop === 'withFailureHandler') {
            return function(failFn) {
                return new Proxy({}, {
                    get: function(t2, prop2) {
                        if (prop2 === 'withSuccessHandler') {
                            return function(successFn) {
                                return new Proxy({}, {
                                    get: function(t3, prop3) {
                                        return function() {
                                            var args = Array.from(arguments);
                                            var fn = _gasFunctions[prop3];
                                            if (fn) {
                                                Promise.resolve(fn.apply(null, args))
                                                    .then(successFn).catch(failFn);
                                            } else {
                                                failFn(new Error('Función no implementada: ' + prop3));
                                            }
                                        };
                                    }
                                });
                            };
                        }
                        return function() {
                            var args = Array.from(arguments);
                            var fn = _gasFunctions[prop2];
                            if (fn) {
                                Promise.resolve(fn.apply(null, args)).catch(failFn);
                            }
                        };
                    }
                });
            };
        }
        // Llamada directa: google.script.run.functionName()
        return function() {
            var args = Array.from(arguments);
            var fn = _gasFunctions[prop];
            if (fn) {
                return Promise.resolve(fn.apply(null, args));
            } else {
                console.warn('GAS polyfill: función no encontrada:', prop);
            }
        };
    }
});
