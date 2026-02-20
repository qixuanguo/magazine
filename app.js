import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";

const PDF_URL = "assets/magazine.pdf";
const MIN_GESTURE_SCALE = 1;
const MAX_GESTURE_SCALE = 3;

const flipbookEl = document.getElementById("flipbook");
const zoomSurfaceEl = document.getElementById("zoomSurface");
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const downloadBtn = document.getElementById("downloadBtn");

let pdfDoc = null;
let pageFlip = null;
let busy = false;
let spreadCount = 0;

const gestureState = {
  scale: 1,
  tx: 0,
  ty: 0,
  startScale: 1,
  startTx: 0,
  startTy: 0,
  startDistance: 0,
  startCenterX: 0,
  startCenterY: 0,
  dragStartX: 0,
  dragStartY: 0,
  pinchActive: false,
  panActive: false
};

function setStatus(message) {
  statusEl.textContent = message;
}

function disableControls(disabled) {
  [shareBtn, downloadBtn].forEach((el) => {
    el.toggleAttribute("disabled", disabled);
    if (el.tagName === "A") {
      el.setAttribute("aria-disabled", String(disabled));
      el.style.pointerEvents = disabled ? "none" : "auto";
      el.style.opacity = disabled ? "0.65" : "1";
    }
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getTouchDistance(touchA, touchB) {
  const dx = touchA.clientX - touchB.clientX;
  const dy = touchA.clientY - touchB.clientY;
  return Math.hypot(dx, dy);
}

function getTouchCenter(touchA, touchB) {
  return {
    x: (touchA.clientX + touchB.clientX) / 2,
    y: (touchA.clientY + touchB.clientY) / 2
  };
}

function getPanBounds() {
  const rect = zoomSurfaceEl.getBoundingClientRect();
  const maxX = (rect.width * (gestureState.scale - 1)) / 2;
  const maxY = (rect.height * (gestureState.scale - 1)) / 2;
  return { maxX, maxY };
}

function applyGestureTransform() {
  const { maxX, maxY } = getPanBounds();
  gestureState.tx = clamp(gestureState.tx, -maxX, maxX);
  gestureState.ty = clamp(gestureState.ty, -maxY, maxY);
  flipbookEl.style.transform = `translate(${gestureState.tx}px, ${gestureState.ty}px) scale(${gestureState.scale})`;
}

function resetGestureTransform() {
  gestureState.scale = 1;
  gestureState.tx = 0;
  gestureState.ty = 0;
  applyGestureTransform();
}

function clearFlipbook() {
  if (pageFlip) {
    pageFlip.destroy();
    pageFlip = null;
  }
  flipbookEl.innerHTML = "";
}

function createPortraitPage(canvas) {
  const pageEl = document.createElement("div");
  pageEl.className = "flip-page";
  pageEl.appendChild(canvas);
  return [pageEl];
}

function createLandscapeSpreadFromCanvas(canvas) {
  const imgUrl = canvas.toDataURL("image/jpeg", 0.92);

  const leftEl = document.createElement("div");
  leftEl.className = "flip-page flip-split left";
  leftEl.style.backgroundImage = `url(${imgUrl})`;

  const rightEl = document.createElement("div");
  rightEl.className = "flip-page flip-split right";
  rightEl.style.backgroundImage = `url(${imgUrl})`;

  return [leftEl, rightEl];
}

async function renderCanvasForPdfPage(pdfPage) {
  const rawViewport = pdfPage.getViewport({ scale: 1 });
  const targetHeight = Math.max(720, zoomSurfaceEl.clientHeight - 40);
  const scale = targetHeight / rawViewport.height;
  const viewport = pdfPage.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext("2d", { alpha: false });
  await pdfPage.render({ canvasContext: context, viewport }).promise;
  return { canvas, viewport };
}

async function renderFlipPages() {
  const renderedPages = [];
  spreadCount = 0;

  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const pdfPage = await pdfDoc.getPage(i);
    const { canvas, viewport } = await renderCanvasForPdfPage(pdfPage);

    const isLandscape = viewport.width > viewport.height * 1.1;
    const htmlPages = isLandscape
      ? createLandscapeSpreadFromCanvas(canvas)
      : createPortraitPage(canvas);

    if (isLandscape) {
      spreadCount += 1;
    }

    renderedPages.push(...htmlPages);
  }

  return renderedPages;
}

function initFlipbook(htmlPages) {
  if (!htmlPages.length) {
    throw new Error("No pages were rendered from the PDF.");
  }

  pageFlip = new St.PageFlip(flipbookEl, {
    width: 1100,
    height: 780,
    size: "stretch",
    minWidth: 280,
    minHeight: 360,
    maxWidth: 1800,
    maxHeight: 1200,
    maxShadowOpacity: 0.35,
    showCover: true,
    mobileScrollSupport: false,
    usePortrait: true,
    startPage: 0,
    swipeDistance: 18,
    clickEventForward: true
  });

  pageFlip.loadFromHTML(htmlPages);
  setStatus(`Loaded ${pdfDoc.numPages} PDF pages (${spreadCount} landscape spreads).`);

  pageFlip.on("flip", (event) => {
    const current = event.data + 1;
    setStatus(`Viewing spread page ${current} of ${pageFlip.getPageCount()}.`);
  });
}

async function rebuildFlipbook() {
  if (busy || !pdfDoc) {
    return;
  }

  busy = true;
  disableControls(true);
  setStatus("Rendering magazine pages…");

  try {
    const currentPageIndex = pageFlip?.getCurrentPageIndex() ?? 0;
    clearFlipbook();
    const htmlPages = await renderFlipPages();
    initFlipbook(htmlPages);
    resetGestureTransform();

    if (currentPageIndex > 0) {
      pageFlip.turnToPage(Math.min(currentPageIndex, pageFlip.getPageCount() - 1));
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not render PDF. Check that assets/magazine.pdf exists.");
  } finally {
    disableControls(false);
    busy = false;
  }
}

function initTouchGestures() {
  zoomSurfaceEl.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 2) {
        const [a, b] = event.touches;
        gestureState.pinchActive = true;
        gestureState.panActive = false;
        gestureState.startDistance = getTouchDistance(a, b);
        const center = getTouchCenter(a, b);
        gestureState.startCenterX = center.x;
        gestureState.startCenterY = center.y;
        gestureState.startScale = gestureState.scale;
        gestureState.startTx = gestureState.tx;
        gestureState.startTy = gestureState.ty;
      } else if (event.touches.length === 1 && gestureState.scale > 1.02) {
        const touch = event.touches[0];
        gestureState.panActive = true;
        gestureState.pinchActive = false;
        gestureState.dragStartX = touch.clientX - gestureState.tx;
        gestureState.dragStartY = touch.clientY - gestureState.ty;
      }
    },
    { passive: true }
  );

  zoomSurfaceEl.addEventListener(
    "touchmove",
    (event) => {
      if (gestureState.pinchActive && event.touches.length === 2) {
        const [a, b] = event.touches;
        const currentDistance = getTouchDistance(a, b);
        const center = getTouchCenter(a, b);
        const ratio = currentDistance / Math.max(gestureState.startDistance, 1);

        gestureState.scale = clamp(
          gestureState.startScale * ratio,
          MIN_GESTURE_SCALE,
          MAX_GESTURE_SCALE
        );

        const centerDx = center.x - gestureState.startCenterX;
        const centerDy = center.y - gestureState.startCenterY;
        gestureState.tx = gestureState.startTx + centerDx;
        gestureState.ty = gestureState.startTy + centerDy;

        applyGestureTransform();
        event.preventDefault();
      } else if (gestureState.panActive && event.touches.length === 1) {
        const touch = event.touches[0];
        gestureState.tx = touch.clientX - gestureState.dragStartX;
        gestureState.ty = touch.clientY - gestureState.dragStartY;
        applyGestureTransform();
        event.preventDefault();
      }
    },
    { passive: false }
  );

  zoomSurfaceEl.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) {
        gestureState.pinchActive = false;
      }

      if (event.touches.length === 0) {
        gestureState.panActive = false;
      }

      if (gestureState.scale <= 1.01) {
        resetGestureTransform();
      }
    },
    { passive: true }
  );
}

async function loadPdf() {
  disableControls(true);

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs";

    const loadingTask = pdfjsLib.getDocument(PDF_URL);
    pdfDoc = await loadingTask.promise;
    await rebuildFlipbook();
  } catch (error) {
    console.error(error);
    setStatus("Failed to load PDF.js or magazine.pdf.");
    disableControls(false);
  }
}

shareBtn.addEventListener("click", async () => {
  const shareData = {
    title: document.title,
    text: "Read this magazine",
    url: window.location.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.url);
      setStatus("Link copied to clipboard.");
      return;
    }

    setStatus(`Share this link: ${shareData.url}`);
  } catch {
    setStatus("Sharing is unavailable in this browser.");
  }
});

// Download action is hard-linked to the PDF file only.
downloadBtn.addEventListener("click", (event) => {
  event.stopPropagation();
});

window.addEventListener("resize", () => {
  if (!pdfDoc || busy) {
    return;
  }

  clearTimeout(window.__resizeTimer);
  window.__resizeTimer = setTimeout(() => {
    rebuildFlipbook();
  }, 200);
});

initTouchGestures();
loadPdf();
