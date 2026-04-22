const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

$("#year").textContent = new Date().getFullYear();

/* Mobile menu */
const menuBtn = $(".menuBtn");
const links = $("[data-links]");
if (menuBtn && links) {
  menuBtn.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });
  $$("a", links).forEach((a) =>
    a.addEventListener("click", () => {
      links.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    }),
  );
}

/* Scroll reveal */
const prefersReduced = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const revealEls = $$(".reveal");
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add("visible");
    });
  },
  { threshold: 0.12 },
);
revealEls.forEach((el) => io.observe(el));

/* Auto-load background images (cards + reel) */
function applyBgImages(selector) {
  $$(selector).forEach((el) => {
    const src = el.getAttribute("data-image");
    if (!src) return;

    const img = new Image();
    img.src = src;
    img.onload = () => {
      el.classList.add("hasImage");
      el.style.backgroundImage = `url('${src}')`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      // Keep text visible in showreel; hide label text in work media tiles
      if (el.classList.contains("media")) el.style.color = "transparent";
    };
  });
}
applyBgImages(".media[data-image]");
applyBgImages(".reelMedia[data-image]");
applyBgImages(".caseHeroImage[data-image]");
applyBgImages(".shotMedia[data-image]");

/* Spotlight cursor */
const spotlight = $(".spotlight");
if (spotlight && !prefersReduced) {
  window.addEventListener("mousemove", (e) => {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    spotlight.style.setProperty("--mx", `${x}%`);
    spotlight.style.setProperty("--my", `${y}%`);
  });
  window.addEventListener(
    "mouseleave",
    () => (spotlight.style.opacity = ".25"),
  );
  window.addEventListener(
    "mouseenter",
    () => (spotlight.style.opacity = ".85"),
  );
}

/* Premium subtle 3D tilt */
function attachTilt(el) {
  const max = 8;
  const damp = 18;
  let rx = 0,
    ry = 0;

  const move = (e) => {
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;

    const ty = (px - 0.5) * (max * 2);
    const tx = (0.5 - py) * (max * 2);

    ry += (ty - ry) / damp;
    rx += (tx - rx) / damp;

    el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateY(-2px)`;
  };

  const reset = () => {
    el.style.transform = `rotateX(0deg) rotateY(0deg) translateY(0px)`;
  };

  el.addEventListener("mousemove", move);
  el.addEventListener("mouseleave", reset);
  el.addEventListener("blur", reset);
}
if (!prefersReduced) $$("[data-tilt]").forEach(attachTilt);

/* Magnetic button */
function attachMagnet(btn) {
  const strength = 14;
  const reset = () => {
    btn.style.transform = "";
  };

  btn.addEventListener("mousemove", (e) => {
    const r = btn.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    btn.style.transform = `translate(${dx / strength}px, ${dy / strength}px)`;
  });

  btn.addEventListener("mouseleave", reset);
  btn.addEventListener("blur", reset);
}
if (!prefersReduced) $$(".magnetic").forEach(attachMagnet);

/* =========================
   Projects (titles + descriptions)
   ========================= */
const PROJECTS = {
  p1: {
    title: "Service‑Based Business Website",
    desc: "A clean, modern website designed for a service‑based business, focused on structure, responsive layout, and intuitive user flow. The build prioritized clarity, accessibility, and performance to help users quickly understand services and take action.",
    tags: ["Website", "Responsive", "Performance"],
    bullets: [
      "Structured layout designed for clarity and quick navigation",
      "Responsive behavior across devices with consistent spacing and typography",
      "Performance‑minded UI with accessible, readable design",
    ],
  },
  p2: {
    title: "Custom Appointment Booking System",
    desc: "A custom booking system built to handle appointment selection, validation, and user feedback. The interface was designed to feel simple and reliable, with clear states and logical flow to reduce friction and improve the booking experience.",
    tags: ["Web App", "Validation", "UX"],
    bullets: [
      "Clear user flow from selection to confirmation",
      "Validation and feedback designed for confidence and speed",
      "Practical interaction states for a low‑friction experience",
    ],
  },
  p3: {
    title: "Front‑End Improvements and UI Refinement",
    desc: "Front‑end improvements focused on accessibility, layout structure, and visual consistency. The work refined spacing, typography, and interaction patterns to create a cleaner, more usable interface without rebuilding the site from scratch.",
    tags: ["UI", "Accessibility", "Refinement"],
    bullets: [
      "Improved layout rhythm: spacing, type, and component consistency",
      "Accessibility‑focused refinements to interaction and readability",
      "Targeted changes that elevate usability without a full rebuild",
    ],
  },
};

/* =========================
   Modal
   ========================= */
const modal = $("#modal");
const modalBody = $("#modalBody");

function openModal(key) {
  const p = PROJECTS[key];
  if (!p) return;

  modalBody.innerHTML = `
    <h3 style="margin:0 0 8px; font-family: Fraunces, serif; font-weight:400; font-size: 1.7rem;">${p.title}</h3>
    <p style="margin:0 0 12px;">${p.desc}</p>
    <ul style="margin:0; padding-left: 18px;">
      ${p.bullets.map((b) => `<li style="margin:6px 0; color: var(--text-secondary); font-weight:800;">${b}</li>`).join("")}
    </ul>
    <div class="tags">
      ${p.tags.map((t) => `<span class="tag">${t}</span>`).join("")}
    </div>
  `;

  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

$$(".card").forEach((card) => {
  const key = card.getAttribute("data-project");
  card.addEventListener("click", () => openModal(key));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal(key);
    }
  });
});

/* Allow showreel tiles to open modal too */
$$(".reelItem[data-project]").forEach((item) => {
  const key = item.getAttribute("data-project");
  item.addEventListener("click", (e) => {
    e.preventDefault();
    openModal(key);
  });
});

$$("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false")
    closeModal();
});

/* Contact form demo note */
const form = $("#contactForm");
const note = $("#formNote");
if (form) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    note.textContent =
      "Message ready. Connect this form to your preferred email/form handler.";
    form.reset();
  });
}

/* =========================
   SHOWREEL: snap + drag inertia
   ========================= */
(function initShowreel() {
  const reel = document.querySelector("[data-reel]");
  if (!reel) return;
  if (prefersReduced) return;

  const prevBtn = document.querySelector("[data-reel-prev]");
  const nextBtn = document.querySelector("[data-reel-next]");

  function stepSize() {
    const item = reel.querySelector("[data-reel-item]");
    if (!item) return 360;
    const gap = 14;
    return item.getBoundingClientRect().width + gap;
  }

  function scrollByStep(dir) {
    reel.scrollBy({ left: dir * stepSize(), behavior: "smooth" });
  }

  prevBtn?.addEventListener("click", () => scrollByStep(-1));
  nextBtn?.addEventListener("click", () => scrollByStep(1));

  reel.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollByStep(-1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollByStep(1);
    }
  });

  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let lastX = 0;
  let lastTime = 0;
  let velocity = 0;
  let raf = null;

  const friction = 0.92;
  const minVel = 0.15;

  function snapToNearest() {
    const items = [...reel.querySelectorAll("[data-reel-item]")];
    if (!items.length) return;

    const reelRect = reel.getBoundingClientRect();
    const reelLeft = reelRect.left;

    let best = items[0];
    let bestDist = Infinity;

    for (const it of items) {
      const r = it.getBoundingClientRect();
      const dist = Math.abs(r.left - reelLeft - 6);
      if (dist < bestDist) {
        bestDist = dist;
        best = it;
      }
    }

    const targetLeft = best.offsetLeft - 6;
    reel.scrollTo({ left: targetLeft, behavior: "smooth" });
  }

  function tick() {
    reel.scrollLeft += velocity;
    velocity *= friction;

    if (Math.abs(velocity) < minVel) {
      cancelAnimationFrame(raf);
      raf = null;
      snapToNearest();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function pointerDown(e) {
    isDown = true;
    startX = e.clientX;
    startScroll = reel.scrollLeft;

    lastX = e.clientX;
    lastTime = performance.now();
    velocity = 0;

    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    reel.setPointerCapture?.(e.pointerId);
  }

  function pointerMove(e) {
    if (!isDown) return;
    const x = e.clientX;
    const dx = x - startX;

    reel.scrollLeft = startScroll - dx;

    const now = performance.now();
    const dt = now - lastTime || 16;
    const vx = (x - lastX) / dt;

    velocity = -vx * 18;
    lastX = x;
    lastTime = now;
  }

  function pointerUp() {
    if (!isDown) return;
    isDown = false;

    if (Math.abs(velocity) > 0.4) {
      raf = requestAnimationFrame(tick);
    } else {
      snapToNearest();
    }
  }

  reel.addEventListener("pointerdown", pointerDown, { passive: true });
  reel.addEventListener("pointermove", pointerMove, { passive: true });
  reel.addEventListener("pointerup", pointerUp, { passive: true });
  reel.addEventListener("pointercancel", pointerUp, { passive: true });

  let snapTimer = null;
  reel.addEventListener(
    "scroll",
    () => {
      if (isDown) return;
      clearTimeout(snapTimer);
      snapTimer = setTimeout(snapToNearest, 120);
    },
    { passive: true },
  );
})();
// Prevent card click modal when clicking links inside cards
document.addEventListener("click", (e) => {
  const link = e.target.closest("a");
  if (!link) return;

  const insideCard = link.closest(".card");
  if (insideCard) {
    e.stopPropagation();
  }
});
