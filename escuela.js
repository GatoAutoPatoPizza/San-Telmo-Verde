/* ============================================
   INTEGRANTES — espacio extra: Escuela Técnica N.º 35
   Agrega UN espacio más al final de la grilla #integrantesGrid, sin tocar
   cómo script.js arma las tarjetas de cada integrante. Si script.js vuelve
   a dibujar la grilla, el espacio se vuelve a agregar solo.
============================================ */
(function () {
  'use strict';

  const ID = 'integranteEscuela';
  const grid = document.getElementById('integrantesGrid');
  if (!grid) return;

  function crearEspacio() {
    // Si ya hay tarjetas, copia su clase para respetar el tamaño/estilo de la grilla
    const ref = Array.prototype.find.call(grid.children, (n) => n.id !== ID);
    const slot = document.createElement('div');
    slot.id = ID;
    slot.className = (ref && ref.className ? ref.className + ' ' : '') + 'integrante-escuela';

    const ico = document.createElement('div');
    ico.className = 'ie-ico';
    ico.textContent = '🏫';
    ico.setAttribute('aria-hidden', 'true');

    const label = document.createElement('div');
    label.className = 'ie-label';
    label.textContent = 'Nuestra escuela';

    const titulo = document.createElement('div');
    titulo.className = 'ie-titulo';
    titulo.textContent = 'Somos de la Escuela Técnica N.º 35';

    slot.append(ico, label, titulo);
    return slot;
  }

  function asegurar() {
    let slot = document.getElementById(ID);
    if (!slot) slot = crearEspacio();
    // Siempre al final de la grilla (no hace nada si ya está último)
    if (grid.lastElementChild !== slot) grid.appendChild(slot);
  }

  asegurar();
  new MutationObserver(asegurar).observe(grid, { childList: true });
})();
