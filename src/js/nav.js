/* Comportement du menu mobile, partagé par les pages de contenu
   (index.html gère ce même comportement directement dans app.js). */
(() => {
  "use strict";
  const menuToggle = document.getElementById("menu-toggle");
  const mobileNav = document.getElementById("mobile-nav");
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
  }
})();
