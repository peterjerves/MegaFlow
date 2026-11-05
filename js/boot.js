/*
 * MegaFlow — arranque mínimo (script clásico, se ejecuta antes de pintar la página).
 * 1) Aplica el tema guardado (única preferencia almacenada; nunca documentos).
 * 2) Vigila que la aplicación principal (módulos ES) se haya iniciado; si no, muestra
 *    un aviso visible en lugar de dejar botones que no responden.
 */
(function () {
  'use strict';
  var KEY = 'megaflow-theme';
  var theme = null;
  try { theme = localStorage.getItem(KEY); } catch (e) { /* sin almacenamiento */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);

  function showBootError(detail) {
    var box = document.getElementById('boot-error');
    if (!box) return;
    box.hidden = false;
    var d = box.querySelector('[data-detail]');
    if (d && detail) d.textContent = detail;
  }

  var moduleErrors = [];
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t.tagName === 'SCRIPT') moduleErrors.push('No se pudo cargar ' + (t.src || 'un script'));
  }, true);

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (window.__megaflowReady) return;
      var isFile = location.protocol === 'file:';
      showBootError(
        (isFile ? 'Abriste index.html directamente desde el disco (file://). Los navegadores bloquean los módulos en ese modo: publica la carpeta en GitHub Pages o usa un servidor web local. ' : '') +
        (moduleErrors.length ? moduleErrors.join('. ') + '. ' : '') +
        'Recarga la página con Ctrl+Shift+R (Windows) o Cmd+Shift+R (Mac). Si persiste, verifica que se subieron las carpetas js/, css/ y vendor/ completas.'
      );
    }, 4000);
  });
})();
