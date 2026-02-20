import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";

const PDF_URL = "assets/magazine.pdf";
const LANDSCAPE_RATIO = 1.08;
const MIN_GESTURE_SCALE = 1;
const MAX_GESTURE_SCALE = 3;
const ZOOM_LOCK_THRESHOLD = 1.02;

const flipbookEl = document.getElementById("flipbook");
const zoomSurfaceEl = document.getElementById("zoomSurface");
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const downloadBtn = document.getElementById("downloadBtn");

let pdfDoc = null;
let pageFlip = null;
let busy = false;
let spreadCount = 0;
let physicalPageCount = 0;
let pageWidth = 595;
let pageHeight = 842;

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

function updateZoomStateClass() {
  flipbookEl.classList.toggle("is-zoomed", gestureState.scale > ZOOM_LOCK_THRESHOLD);
}

function applyGestureTransform() {
  const { maxX, maxY } = getPanBounds();
  gestureState.tx = clamp(gestureState.tx, -maxX, maxX);
  gestureState.ty = clamp(gestureState.ty, -maxY, maxY);
  flipbookEl.style.transform = `translate(${gestureState.tx}px, ${gestureState.ty}px) scale(${gestureState.scale})`;
  updateZoomStateClass();
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

function createPageElementFromCanvas(canvas) {
  const pageEl = document.createElement("div");
  pageEl.className = "flip-page";
  pageEl.appendChild(canvas);
  return pageEl;
}

function splitLandscapeToA4Canvases(sourceCanvas) {
  const halfWidth = Math.floor(sourceCanvas.width / 2);
  const rightWidth = sourceCanvas.width - halfWidth;
  const height = sourceCanvas.height;

  const leftCanvas = document.createElement("canvas");
  leftCanvas.width = halfWidth;
  leftCanvas.height = height;
  const leftContext = leftCanvas.getContext("2d", { alpha: false });
  leftContext.drawImage(sourceCanvas, 0, 0, halfWidth, height, 0, 0, halfWidth, height);

  const rightCanvas = document.createElement("canvas");
  rightCanvas.width = rightWidth;
  rightCanvas.height = height;
  const rightContext = rightCanvas.getContext("2d", { alpha: false });
  rightContext.drawImage(
    sourceCanvas,
    halfWidth,
    0,
    rightWidth,
    height,
    0,
    0,
    rightWidth,
    height
  );

  return [leftCanvas, rightCanvas];
}

async function renderSourceCanvas(pdfPage) {
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const targetHeight = Math.max(420, zoomSurfaceEl.clientHeight - 24);
  const scale = targetHeight / baseViewport.height;
  const viewport = pdfPage.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext("2d", { alpha: false });
  await pdfPage.render({ canvasContext: context, viewport }).promise;

  return { canvas, viewport };
}

async function renderBookPages() {
  const htmlPages = [];
  spreadCount = 0;
  physicalPageCount = 0;
  pageWidth = 595;
  pageHeight = 842;

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
    const pdfPage = await pdfDoc.getPage(pageNumber);
    const { canvas, viewport } = await renderSourceCanvas(pdfPage);

    const forcePortrait = pageNumber === 1 || pageNumber === pdfDoc.numPages;
    const isLandscapeSource = !forcePortrait && viewport.width > viewport.height * LANDSCAPE_RATIO;

    if (isLandscapeSource) {
      const [leftCanvas, rightCanvas] = splitLandscapeToA4Canvases(canvas);

      if (physicalPageCount === 0) {
        pageWidth = leftCanvas.width;
        pageHeight = leftCanvas.height;
      }

      htmlPages.push(createPageElementFromCanvas(leftCanvas));
      htmlPages.push(createPageElementFromCanvas(rightCanvas));
      physicalPageCount += 2;
      spreadCount += 1;
      continue;
    }

    if (physicalPageCount === 0) {
      pageWidth = canvas.width;
      pageHeight = canvas.height;
    }

    htmlPages.push(createPageElementFromCanvas(canvas));
    physicalPageCount += 1;
  }

  return htmlPages;
}

function initFlipbook(htmlPages) {
  if (!htmlPages.length) {
    throw new Error("No pages were rendered from the PDF.");
  }

  pageFlip = new St.PageFlip(flipbookEl, {
    width: pageWidth,
    height: pageHeight,
    size: "stretch",
    minWidth: Math.max(170, Math.floor(pageWidth * 0.36)),
    maxWidth: Math.max(720, Math.floor(pageWidth * 1.9)),
    minHeight: Math.max(240, Math.floor(pageHeight * 0.44)),
    maxHeight: Math.max(960, Math.floor(pageHeight * 1.5)),
    maxShadowOpacity: 0.32,
    showCover: true,
    mobileScrollSupport: false,
    usePortrait: true,
    startPage: 0,
    swipeDistance: 72,
    clickEventForward: false,
    showPageCorners: false,
    flippingTime: 620
  });

  pageFlip.loadFromHTML(htmlPages);

  setStatus(
    `Loaded ${physicalPageCount} book pages from ${pdfDoc.numPages} PDF pages (${spreadCount} landscape spreads split).`
  );

  pageFlip.on("flip", (event) => {
    const currentPage = event.data + 1;
    const totalPages = pageFlip.getPageCount();
    setStatus(`Page ${currentPage} / ${totalPages}`);
  });
}

async function rebuildFlipbook() {
  if (busy || !pdfDoc) {
    return;
  }

  busy = true;
  disableControls(true);
  setStatus("Rendering pages…");

  try {
    const currentPageIndex = pageFlip?.getCurrentPageIndex() ?? 0;
    clearFlipbook();
    const htmlPages = await renderBookPages();
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

        event.preventDefault();
        event.stopPropagation();
      } else if (event.touches.length === 1 && gestureState.scale > ZOOM_LOCK_THRESHOLD) {
        const touch = event.touches[0];
        gestureState.panActive = true;
        gestureState.pinchActive = false;
        gestureState.dragStartX = touch.clientX - gestureState.tx;
        gestureState.dragStartY = touch.clientY - gestureState.ty;

        event.preventDefault();
        event.stopPropagation();
      }
    },
    { passive: false, capture: true }
  );

  zoomSurfaceEl.addEventListener(
    "touchmove",
    (event) => {
      if (gestureState.pinchActive && event.touches.length === 2) {
        const [a, b] = event.touches;
        const currentDistance = getTouchDistance(a, b);
        const ratio = currentDistance / Math.max(gestureState.startDistance, 1);
        const center = getTouchCenter(a, b);

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
        event.stopPropagation();
        return;
      }

      if (gestureState.panActive && event.touches.length === 1) {
        const touch = event.touches[0];
        gestureState.tx = touch.clientX - gestureState.dragStartX;
        gestureState.ty = touch.clientY - gestureState.dragStartY;
        applyGestureTransform();

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (gestureState.scale > ZOOM_LOCK_THRESHOLD && event.touches.length === 1) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { passive: false, capture: true }
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

      if (gestureState.scale > ZOOM_LOCK_THRESHOLD) {
        event.stopPropagation();
      }
    },
    { passive: true, capture: true }
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
  }, 220);
});

initTouchGestures();
loadPdf();
