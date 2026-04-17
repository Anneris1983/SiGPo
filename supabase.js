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

// Cargar el SDK de Supabase desde CDN (se carga una vez)
let _supabase = null;

async function getSupabase() {
    if (_supabase) return _supabase;

    // Si supabase ya fue cargado por un <script> tag
    if (window.supabase && window.supabase.createClient) {
        _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        return _supabase;
    }

    // Cargar dinámicamente
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

/**
 * Login con email + password
 * Los usuarios se crean con email = "{dni}@sigpo.fce" para simplificar
 */
async function login(dni, password) {
    const sb = await getSupabase();
    const email = dni + '@sigpo.fce';

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
        return { ok: false, mensaje: 'DNI o contraseña incorrectos' };
    }

    // Obtener rol del usuario desde la tabla usuarios
    const { data: usuario, error: errUser } = await sb
        .from('usuarios')
        .select('rol, nombre_completo, email, programa_id, dni')
        .eq('dni', dni)
        .eq('activo', true)
        .single();

    if (errUser || !usuario) {
        return { ok: false, mensaje: 'Usuario no encontrado o inactivo' };
    }

    // Guardar en localStorage para acceso rápido
    localStorage.setItem('sigpo_rol', usuario.rol);
    localStorage.setItem('sigpo_nombre', usuario.nombre_completo);
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

/**
 * Logout
 */
async function logout() {
    const sb = await getSupabase();
    await sb.auth.signOut();
    localStorage.removeItem('sigpo_rol');
    localStorage.removeItem('sigpo_nombre');
    localStorage.removeItem('sigpo_dni');
    localStorage.removeItem('sigpo_email');
    localStorage.removeItem('sigpo_programa_id');
    return { ok: true };
}

/**
 * Obtener sesión actual
 */
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

/**
 * Verificar si hay sesión activa, redirigir a login si no
 */
async function requireAuth() {
    const sb = await getSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.href = 'portal_login.html';
        return null;
    }
    return getSesion();
}

/**
 * Recuperar contraseña
 */
async function recuperarPassword(dni) {
    // En producción: buscar email real del usuario y enviar reset
    const sb = await getSupabase();
    const { data: usuario } = await sb
        .from('usuarios')
        .select('email')
        .eq('dni', dni)
        .single();

    if (!usuario) return { ok: false };

    // Supabase envía email de reset
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

// Rutas por rol para redirigir después del login
const RUTAS_POR_ROL = {
    'ESTUDIANTE': 'portal_estudiante_2_dashboard.html',
    'COORDINADOR': 'coordinador_1_dashboard.html',
    'SECRETARIA': 'secretaria_1_dashboard.html',
    'COOPERADORA': 'cooperadora_2_Dashboard.html',
    'ADMINISTRADOR': 'administrador_2_dashboard.html'
};

// ══════════════════════════════════════════════════════════════
// TAXONOMÍA: PROGRAMAS vs CURSOS
// Programas (posgrado): DOCTORADO, MAESTRIA, ESPECIALIZACION → sub-unidad: Cohorte
// Cursos: DIPLOMADO, DIPLOMATURA, CURSO → sub-unidad: Edición
// ══════════════════════════════════════════════════════════════

var TIPOS_PROGRAMA = ['DOCTORADO', 'MAESTRIA', 'ESPECIALIZACION',
                      'doctorado', 'maestria', 'especializacion'];
var TIPOS_CURSO    = ['DIPLOMADO', 'DIPLOMATURA', 'CURSO',
                      'diplomado', 'diplomatura', 'curso'];

/**
 * Devuelve 'Programa' o 'Curso' según el tipo (case-insensitive)
 */
function getCategoriaPrograma(tipo) {
    if (!tipo) return 'Programa';
    return TIPOS_PROGRAMA.indexOf(tipo.toUpperCase()) >= 0 ||
           TIPOS_PROGRAMA.indexOf(tipo) >= 0 ? 'Programa' : 'Curso';
}

/**
 * Devuelve 'Cohorte' o 'Edición' según el tipo de programa (case-insensitive)
 */
function getLabelNomenclatura(tipo) {
    return getCategoriaPrograma(tipo) === 'Programa' ? 'Cohorte' : 'Edición';
}

/**
 * Devuelve 'Cohortes' o 'Ediciones' (plural, case-insensitive)
 */
function getLabelNomenclaturaPlural(tipo) {
    return getCategoriaPrograma(tipo) === 'Programa' ? 'Cohortes' : 'Ediciones';
}

/**
 * Ícono por tipo de programa/curso (case-insensitive)
 */
function getIconoTipo(tipo) {
    var t = (tipo || '').toUpperCase();
    var iconos = {
        'DOCTORADO':      '🎓',
        'MAESTRIA':       '📊',
        'ESPECIALIZACION':'💼',
        'DIPLOMADO':      '🏅',
        'DIPLOMATURA':    '📜',
        'CURSO':          '📖'
    };
    return iconos[t] || '📚';
}

// ══════════════════════════════════════════════════════════════
// NOTIFICACIONES (campana)
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

// Funciones de UI para la campana (usadas por todas las vistas)
function toggleNotif() {
    var dd = document.getElementById('notif-dropdown');
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

// Cerrar dropdown al click fuera
document.addEventListener('click', function (e) {
    var w = document.querySelector('.notif-wrapper');
    if (w && !w.contains(e.target)) {
        var dd = document.getElementById('notif-dropdown');
        if (dd) dd.style.display = 'none';
    }
});

// ══════════════════════════════════════════════════════════════
// FUNCIONES DE DATOS — PROGRAMAS / COHORTES / ESTUDIANTES
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

async function obtenerEstudiantes(programaId, cohorteId) {
    const sb = await getSupabase();
    let query = sb.from('estudiantes').select('*');
    if (programaId) query = query.eq('programa_id', programaId);
    if (cohorteId) query = query.eq('cohorte_id', cohorteId);
    const { data } = await query.order('apellido');
    return data || [];
}

async function obtenerDetallePrograma(programaId) {
    const sb = await getSupabase();
    console.log('🚀 [obtenerDetallePrograma] Iniciando:', programaId);
    
    const [progRes, cohRes, inscRes, cobRes, egrRes] = await Promise.all([
        sb.from('programas').select('*').eq('programa_id', programaId).single(),
        sb.from('cohortes').select('*').eq('programa_id', programaId).order('fecha_inicio', { ascending: false }),
        sb.from('inscripciones').select('*'),  // ✅ INSCRIPCIONES, NO ESTUDIANTES
        sb.from('cobros').select('*').eq('programa_id', programaId),
        sb.from('egresos').select('egreso_id,cohorte_id,monto_pagado').eq('programa_id', programaId)
    ]);
    
    var prog = progRes.data;
    if (!prog) {
        console.error('❌ Programa NO ENCONTRADO');
        return null;
    }
    
    var cohortes = cohRes.data || [];
    var inscripciones = inscRes.data || [];  // ✅ CAMBIO CRÍTICO
    var cobros = cobRes.data || [];
    var egresos = egrRes.data || [];

    console.log('📊 Datos cargados:', { 
        cohortes: cohortes.length, 
        inscripciones: inscripciones.length, 
        cobros: cobros.length 
    });

    return {
        id: prog.programa_id,
        nombre: prog.nombre,
        tipo: prog.tipo,
        cohortes: cohortes.map(function(coh) {
            // ✅ USAR INSCRIPCIONES, NO ESTUDIANTES
            var inscCoh = inscripciones.filter(function(i) { 
                return i.cohorte_id === coh.cohorte_id; 
            });
            
            var cobrosCoh = cobros.filter(function(c) { 
                return c.cohorte_id === coh.cohorte_id; 
            });
            
            var egresosCoh = egresos.filter(function(e) { 
                return e.cohorte_id === coh.cohorte_id; 
            });
            
            // ✅ CONTAR POR INSCRIPCIÓN (no por estudiante)
            var enMora = 0, alDia = 0;
            inscCoh.forEach(function(insc) {
                // Buscar si este estudiante tiene EN_MORA
                var tieneEnMora = cobrosCoh.some(function(c) { 
                    return c.dni && insc.estudiante_id && c.estado === 'EN_MORA'; 
                });
                if (tieneEnMora) {
                    enMora++;
                } else {
                    alDia++;
                }
            });
            
            // ✅ SOLO CONTAR RECAUDADO SI ESTÁ ABONADA O PAGO_PARCIAL
            var recaudado = cobrosCoh.reduce(function(s, c) {
                if (c.estado === 'ABONADA' || c.estado === 'PAGO_PARCIAL') {
                    var mAbonado = Math.max(0, (Number(c.monto_final || 0) - Number(c.saldo_pendiente || 0)));
                    return s + mAbonado;
                }
                return s;
            }, 0);
            
            var egresosMonto = egresosCoh.reduce(function(s, e) {
                return s + Number(e.monto_pagado || 0);
            }, 0);
            
            console.log('💰', coh.nombre, {
                inscripciones: inscCoh.length,
                alDia: alDia,
                enMora: enMora,
                recaudado: recaudado
            });
            
            return {
                id: coh.cohorte_id,
                nombre: coh.nombre,
                estado: coh.estado,
                fechaInicio: coh.fecha_inicio,
                fechaFin: coh.fecha_fin,
                estudiantes: inscCoh.length,
                alDia: alDia,
                enMora: enMora,
                recaudado: recaudado,
                egresos: egresosMonto,
                saldo: recaudado - egresosMonto
            };
        })
    };
}

// ══════════════════════════════════════════════════════════════
// FUNCIONES DE DATOS — COBROS (CUOTAS)
// ══════════════════════════════════════════════════════════════

async function obtenerCobros(filtros) {
    const sb = await getSupabase();
    let query = sb.from('cobros').select('*');
    if (filtros) {
        if (filtros.dni) query = query.eq('dni', filtros.dni);
        if (filtros.programa_id) query = query.eq('programa_id', filtros.programa_id);
        if (filtros.cohorte_id) query = query.eq('cohorte_id', filtros.cohorte_id);
        if (filtros.estado) query = query.eq('estado', filtros.estado);
    }
    const { data } = await query.order('fecha_vencimiento');
    return data || [];
}

async function subirComprobante(cobroId, file) {
    const sb = await getSupabase();
    const sesion = getSesion();
    if (!sesion) return { ok: false };

    // 1. Subir archivo a Storage
    const fileName = sesion.dni + '/' + Date.now() + '_' + file.name;
    const { data: uploadData, error: uploadErr } = await sb.storage
        .from('comprobantes')
        .upload(fileName, file);

    if (uploadErr) return { ok: false, mensaje: 'Error al subir archivo: ' + uploadErr.message };

    // 2. Obtener URL pública
    const { data: urlData } = sb.storage.from('comprobantes').getPublicUrl(fileName);

    // 3. Actualizar cobro → estado PENDIENTE
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

    // 1. Subir recibo (obligatorio según reglas)
    let reciboUrl = null;
    if (reciboFile) {
        const fileName = 'recibos/' + cobroId + '/' + Date.now() + '_' + reciboFile.name;
        const { error: uploadErr } = await sb.storage.from('comprobantes').upload(fileName, reciboFile);
        if (uploadErr) return { ok: false, mensaje: 'Error al subir recibo' };
        const { data: urlData } = sb.storage.from('comprobantes').getPublicUrl(fileName);
        reciboUrl = urlData.publicUrl;
    }

    if (!reciboUrl) return { ok: false, mensaje: 'Sin recibo, no se puede aprobar (Regla 1)' };

    // 2. Obtener cobro actual
    const { data: cobro } = await sb.from('cobros').select('*').eq('cobro_id', cobroId).single();
    if (!cobro) return { ok: false, mensaje: 'Cobro no encontrado' };

    if (tipo === 'COMPLETO') {
        // Pago completo → ABONADA
        await sb.from('cobros').update({
            estado: 'ABONADA',
            saldo_pendiente: 0,
            fecha_pago: new Date().toISOString().split('T')[0],
            recibo_url: reciboUrl
        }).eq('cobro_id', cobroId);
    } else {
        // Pago parcial → PAGO_PARCIAL
        var nuevoSaldo = cobro.monto_final - montoAprobado;
        await sb.from('cobros').update({
            estado: 'PAGO_PARCIAL',
            saldo_pendiente: nuevoSaldo,
            recibo_url: reciboUrl
        }).eq('cobro_id', cobroId);

        // Registrar pago parcial
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

    // Obtener cobro para determinar estado real post-rechazo
    const { data: cobro } = await sb.from('cobros').select('*').eq('cobro_id', cobroId).single();
    if (!cobro) return { ok: false };

    var nuevoEstado = 'NO_ABONADA'; // default

    // Regla de rechazo: volver al estado real
    if (!cobro.monto_final || cobro.monto_final === 0) {
        nuevoEstado = 'A_DEFINIR';
    } else if (cobro.fecha_vencimiento && new Date(cobro.fecha_vencimiento) < new Date()) {
        nuevoEstado = 'EN_MORA';
    } else {
        // Verificar si tiene pagos parciales previos
        const { data: pagos } = await sb.from('pagos').select('monto').eq('cobro_id', cobroId);
        var totalPagado = (pagos || []).reduce(function (s, p) { return s + Number(p.monto); }, 0);
        if (totalPagado > 0) {
            nuevoEstado = 'PAGO_PARCIAL';
        } else {
            nuevoEstado = 'NO_ABONADA';
        }
    }

    await sb.from('cobros').update({
        estado: nuevoEstado,
        comprobante_url: null,
        comprobante_fecha: null
    }).eq('cobro_id', cobroId);

    return { ok: true, nuevoEstado: nuevoEstado };
}

// ══════════════════════════════════════════════════════════════
// FUNCIONES DE DATOS — EGRESOS
// ══════════════════════════════════════════════════════════════

async function obtenerEgresos(filtros) {
    const sb = await getSupabase();
    let query = sb.from('egresos').select('*');
    if (filtros) {
        if (filtros.programa_id) query = query.eq('programa_id', filtros.programa_id);
        if (filtros.cohorte_id) query = query.eq('cohorte_id', filtros.cohorte_id);
        if (filtros.tipo) query = query.eq('tipo', filtros.tipo);
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
// FUNCIONES DE DATOS — CONFIGURACIÓN
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
        await sb.from('configuracion').upsert({ clave: clave, valor: datos[clave] }, { onConflict: 'clave' });
    }
    return { ok: true };
}

// ══════════════════════════════════════════════════════════════
// FUNCIONES DE DATOS — CATEGORÍAS DE GASTOS
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
// FUNCIONES DE DATOS — USUARIOS
// ══════════════════════════════════════════════════════════════

async function obtenerUsuarios() {
    const sb = await getSupabase();
    const { data } = await sb.from('usuarios').select('*').order('nombre_completo');
    return data || [];
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
// FUNCIONES DE DATOS — DASHBOARD ADMIN
// ══════════════════════════════════════════════════════════════

async function obtenerDashboardAdmin() {
    const sb = await getSupabase();

    const [progRes, cohRes, estRes, cobRes, egrRes] = await Promise.all([
        sb.from('programas').select('*'),
        sb.from('cohortes').select('*'),
        sb.from('estudiantes').select('*').eq('estado_academico', 'ACTIVO'),
        sb.from('cobros').select('*'),
        sb.from('egresos').select('*')
    ]);

    var programas = progRes.data || [];
    var cohortes = cohRes.data || [];
    var estudiantes = estRes.data || [];
    var cobros = cobRes.data || [];
    var egresos = egrRes.data || [];

    var totalRecaudado = cobros.reduce(function (s, c) {
        return s + (Number(c.monto_final || 0) - Number(c.saldo_pendiente || 0));
    }, 0);
    var totalEgresos = egresos.reduce(function (s, e) { return s + Number(e.monto_pagado || 0); }, 0);

    var enMora = 0;
    estudiantes.forEach(function (est) {
        if (cobros.some(function (c) { return c.dni === est.dni && c.estado === 'EN_MORA'; })) enMora++;
    });

    var totalProgramasPosgrado = programas.filter(function(p) { return getCategoriaPrograma(p.tipo) === 'Programa'; }).length;
    var totalCursos = programas.filter(function(p) { return getCategoriaPrograma(p.tipo) === 'Curso'; }).length;

    return {
        totalProgramas: programas.length,
        totalProgramasPosgrado: totalProgramasPosgrado,
        totalCursos: totalCursos,
        estudiantesActivos: estudiantes.length,
        alDia: estudiantes.length - enMora,
        enMora: enMora,
        recaudado: totalRecaudado,
        egresos: totalEgresos,
        saldo: totalRecaudado - totalEgresos,
        programas: programas.map(function (p) {
            var estsProg = estudiantes.filter(function (e) { return e.programa_id === p.programa_id; });
            var cohsProg = cohortes.filter(function (c) { return c.programa_id === p.programa_id; });
            var cobrosProg = cobros.filter(function (c) { return c.programa_id === p.programa_id; });
            var egresosProg = egresos.filter(function (e) { return e.programa_id === p.programa_id; });

            var enMoraProg = 0;
            estsProg.forEach(function (est) {
                if (cobrosProg.some(function (c) { return c.dni === est.dni && c.estado === 'EN_MORA'; })) enMoraProg++;
            });

            var recaudadoProg = cobrosProg.reduce(function (s, c) {
                return s + (Number(c.monto_final || 0) - Number(c.saldo_pendiente || 0));
            }, 0);

            var egresosPagadosProg = egresosProg.reduce(function (s, e) {
                return s + Number(e.monto_pagado || 0);
            }, 0);

            return {
                id: p.programa_id,
                nombre: p.nombre,
                tipo: p.tipo,
                categoria: getCategoriaPrograma(p.tipo),
                labelNomenclatura: getLabelNomenclaturaPlural(p.tipo),
                estudiantes: estsProg.length,
                cohortes: cohsProg.length,
                alDia: estsProg.length - enMoraProg,
                enMora: enMoraProg,
                recaudado: recaudadoProg,
                egresos: egresosPagadosProg,
                saldo: recaudadoProg - egresosPagadosProg
            };
        })
    };
}

// ══════════════════════════════════════════════════════════════
// DATOS FACTURACIÓN (ESTUDIANTE)
// ══════════════════════════════════════════════════════════════

async function guardarDatosFacturacion(datos) {
    // TODO: Crear tabla facturacion o agregar campos a estudiantes
    console.log('Datos facturación:', datos);
    return { ok: true };
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

async function obtenerPerfilUsuario() {
    var sesion = getSesion();
    if (!sesion) return null;
    const sb = await getSupabase();
    var r = await sb.from('usuarios').select('*').eq('dni', sesion.dni).single();
    if (!r.data) return null;
    return {
        apellido: (r.data.nombre_completo || '').split(' ').slice(-1)[0] || '',
        nombre: (r.data.nombre_completo || '').split(' ').slice(0, -1).join(' ') || '',
        dni: r.data.dni,
        email: r.data.email,
        rol: r.data.rol
    };
}

// ══════════════════════════════════════════════════════════════
// POLYFILL: google.script.run → Supabase
// Intercepta TODAS las llamadas a google.script.run que existen
// en las 54 vistas y las redirige a funciones de supabase.js
// ══════════════════════════════════════════════════════════════

// Mapa de funciones GAS → funciones Supabase
var _gasFunctions = {
    // Auth
    login: login,
    logout: logout,
    getSesion: getSesion,
    recuperarPassword: recuperarPassword,
    obtenerPerfilUsuario: obtenerPerfilUsuario,

    // Notificaciones
    obtenerNotificaciones: obtenerNotificaciones,
    marcarNotificacionLeida: marcarNotificacionLeida,
    marcarTodasNotificacionesLeidas: marcarTodasNotificacionesLeidas,
    obtenerNotificacionesCoordinador: function() { return obtenerNotificaciones('COORDINADOR'); },
    marcarNotificacionesCooperadoraLeidas: marcarTodasNotificacionesLeidas,
    marcarNotificacionesCoordinadorLeidas: marcarTodasNotificacionesLeidas,

    // Dashboard
    obtenerDashboardAdmin: obtenerDashboardAdmin,
    obtenerDashboardCoordinador: async function() { return obtenerDashboardAdmin(); },

    // Programas / Cohortes
    obtenerDetallePrograma: obtenerDetallePrograma,
    getProgramas: obtenerProgramas,
    cambiarEstadoCohorte: async function(id, estado) {
        var sb = await getSupabase();
        var r = await sb.from('cohortes').update({ estado: estado }).eq('cohorte_id', id);
        return { ok: !r.error };
    },

    // Cobros
    subirComprobante: subirComprobante,
    obtenerUrlComprobante: async function(cobroId) {
        var sb = await getSupabase();
        var r = await sb.from('cobros').select('comprobante_url').eq('cobro_id', cobroId).single();
        return r.data ? r.data.comprobante_url : null;
    },

    // Configuración
    obtenerConfiguracion: obtenerConfiguracion,
    guardarConfiguracion: guardarConfiguracion,
    obtenerCategoriasGastos: obtenerCategoriasGastos,
    guardarCategoriasGastos: guardarCategoriasGastos,

    // Usuarios
    guardarUsuario: guardarUsuario,
    darDeBaja: darDeBaja,
    darDeAlta: darDeAlta,
    eliminarUsuario: async function(id) { return darDeBaja(id); },
    eliminarRegistroCompleto: async function(id) {
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

    // Reportes / Exportaciones
    getDatosComparativo: async function() { return { periodos: [], datos: [] }; },
    exportarCashflow: async function() { alert('Exportación en desarrollo'); return null; },
    exportarReporteExcel: async function() { alert('Exportación en desarrollo'); return null; },
    exportarEstadoPagosExcel: async function() { alert('Exportación en desarrollo'); return null; },
    exportarEstadoPagosPDF: async function() { alert('Exportación en desarrollo'); return null; },
    exportarDesercionExcel: async function() { alert('Exportación en desarrollo'); return null; },
    exportarDesercionPDF: async function() { alert('Exportación en desarrollo'); return null; },
    exportarImpactoDescuentosExcel: async function() { alert('Exportación en desarrollo'); return null; },
    exportarImpactoDescuentosPDF: async function() { alert('Exportación en desarrollo'); return null; },
    exportarComparativoExcel: async function() { alert('Exportación en desarrollo'); return null; },
    exportarComparativoPDF: async function() { alert('Exportación en desarrollo'); return null; },
    exportarLogsExcel: async function() { alert('Exportación en desarrollo'); return null; },

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
        if (cohorteId) query = query.eq('cohorte_id', cohorteId);
        var r = await query.order('fecha_vencimiento');
        return r.data || [];
    }
};

// Crear el objeto google.script.run que intercepta las llamadas
window.google = window.google || {};
window.google.script = window.google.script || {};
window.google.script.run = new Proxy({}, {
    get: function(target, prop) {
        // withSuccessHandler / withFailureHandler — retornar un builder
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
                                                    .then(successFn)
                                                    .catch(failFn);
                                            } else {
                                                console.warn('GAS polyfill: función no encontrada:', prop3);
                                                failFn(new Error('Función no implementada: ' + prop3));
                                            }
                                        };
                                    }
                                });
                            };
                        }
                        // Direct call after withSuccessHandler
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
                                                    .then(successFn)
                                                    .catch(failFn);
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
        // Direct call: google.script.run.functionName()
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
