/**
 * ══════════════════════════════════════════════════════════════
 * sigpo-componentes.js — Componentes reutilizables (Web Components)
 * Sin build: se incluye con <script> y se usan como etiquetas HTML.
 *
 *   <sigpo-campana rol="SECRETARIA"></sigpo-campana>
 *
 * Reemplaza el bloque repetido de la campana de notificaciones que
 * hoy está copiado en ~67 paginas. La logica (abrir/cerrar, render,
 * marcar leidas, cerrar al click afuera) ya vive en supabase.js;
 * este componente solo inyecta el markup estandar y dispara la carga.
 * ══════════════════════════════════════════════════════════════
 */
(function () {
  if (typeof window === 'undefined' || !window.customElements) return;
  if (customElements.get('sigpo-campana')) return;

  // Markup estandar de la campana (estilos inline => portable a cualquier
  // pagina con header oscuro, sin depender del CSS local de cada una).
  var MARKUP =
    '<div class="notif-wrapper" style="position:relative;display:inline-block;">' +
      '<button class="notif-btn" type="button" onclick="toggleNotif()" title="Notificaciones" ' +
        'style="background:rgba(255,255,255,0.14);border:1.5px solid rgba(255,255,255,0.38);border-radius:8px;padding:7px 10px;cursor:pointer;display:flex;align-items:center;position:relative;">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" fill="white"/></svg>' +
        '<span id="notif-badge" style="position:absolute;top:2px;right:2px;background:var(--clr-danger);color:#fff;font-size:11px;font-weight:700;min-width:18px;height:18px;border-radius:9px;display:none;align-items:center;justify-content:center;padding:0 4px;border:2px solid #8C1A28;line-height:1;">0</span>' +
      '</button>' +
      '<div id="notif-dropdown" style="display:none;position:absolute;top:calc(100% + 8px);right:0;width:360px;max-height:440px;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.18);z-index:999;border:1px solid #e5e7eb;">' +
        '<div style="padding:14px 18px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">' +
          '<h3 style="font-size:14px;font-weight:700;color:#5C1018;">🔔 Notificaciones</h3>' +
          '<button onclick="marcarTodasLeidas()" style="font-size:12px;color:#C49A2A;cursor:pointer;background:none;border:none;font-weight:600;font-family:\'DM Sans\',sans-serif;">Marcar leídas</button>' +
        '</div>' +
        '<div id="notif-list"><div style="padding:28px;text-align:center;color:#9ca3af;font-size:13px;">Cargando…</div></div>' +
      '</div>' +
    '</div>';

  class SigpoCampana extends HTMLElement {
    connectedCallback() {
      // Light DOM (sin shadow) para que supabase.js alcance los ids globales.
      this.style.display = 'inline-flex';
      this.innerHTML = MARKUP;
      // Cargar notificaciones (independiente del auto-init de supabase.js,
      // por si el componente se conecta despues de DOMContentLoaded).
      try {
        var rol = this.getAttribute('rol') || '';
        if (typeof getSesion === 'function' && getSesion() &&
            typeof obtenerNotificaciones === 'function' &&
            typeof renderNotificaciones === 'function') {
          var r = rol || getSesion().rol;
          obtenerNotificaciones(r).then(renderNotificaciones).catch(function () {});
        }
      } catch (e) { /* sin sesion: queda en "Cargando…" hasta tenerla */ }
    }
  }
  customElements.define('sigpo-campana', SigpoCampana);

  // ════════════════════════════════════════════════════════════
  // <sigpo-logout></sigpo-logout>
  // Boton "Cerrar sesion" unificado. Reemplaza las 4 variantes que estaban
  // repetidas y divergentes en ~48 paginas. Estilo autocontenido (inline),
  // igual al .btn-logout que se veia bien en la mayoria. Llama a la funcion
  // global cerrarSesion() de supabase.js.
  // ════════════════════════════════════════════════════════════
  var LOGOUT_MARKUP =
    '<a href="portal_login.html" onclick="return cerrarSesion(event)" ' +
      'style="display:inline-flex;align-items:center;gap:7px;padding:9px 18px;' +
      'background:rgba(255,255,255,0.14);border:1.5px solid rgba(255,255,255,0.38);' +
      'border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;' +
      'text-decoration:none;transition:background 0.2s;font-family:\'DM Sans\',sans-serif;white-space:nowrap;" ' +
      'onmouseover="this.style.background=\'rgba(255,255,255,0.25)\'" ' +
      'onmouseout="this.style.background=\'rgba(255,255,255,0.14)\'">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
      'Cerrar sesión' +
    '</a>';

  class SigpoLogout extends HTMLElement {
    connectedCallback() {
      this.style.display = 'inline-flex';
      this.innerHTML = LOGOUT_MARKUP;
    }
  }
  customElements.define('sigpo-logout', SigpoLogout);
})();
