import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";

const PDF_URL = "assets/magazine.pdf";
const LANDSCAPE_RATIO = 1.08;
const MIN_GESTURE_SCALE = 1;
const MAX_GESTURE_SCALE = 3;
const ZOOM_LOCK_THRESHOLD = 1.03;
const PAGE_BG_COLOR = "#0f1624";
const IS_COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;

const flipbookEl = document.getElementById("flipbook");
const zoomSurfaceEl = document.getElementById("zoomSurface");
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");
const downloadBtn = document.getElementById("downloadBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const instructionPopupEl = document.getElementById("instructionPopup");
const instructionCountdownEl = document.getElementById("instructionCountdown");
const instructionCloseBtnEl = document.getElementById("instructionCloseBtn");

let pdfDoc = null;
let pageFlip = null;
let busy = false;
let spreadCount = 0;
let totalBookPages = 0;
let pageWidth = 595;
let pageHeight = 842;
let pageNumberMap = [];
let popupIntervalId = null;
let fullscreenFallbackActive = false;

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
  [shareBtn, downloadBtn, fullscreenBtn].forEach((el) => {
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

function getRenderDensity() {
  const dpr = window.devicePixelRatio || 1;
  if (IS_COARSE_POINTER) {
    return clamp(dpr * 0.95, 1.2, 1.9);
  }
  return clamp(dpr * 1.1, 1.4, 2.2);
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
  const zoomLocked = gestureState.scale > ZOOM_LOCK_THRESHOLD;
  flipbookEl.classList.toggle("is-zoomed", zoomLocked);
  zoomSurfaceEl.classList.toggle("is-gesture-locked", zoomLocked);
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

function createBlankPageElement() {
  const pageEl = document.createElement("div");
  pageEl.className = "flip-page flip-page--blank";
  return pageEl;
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function splitLandscapeToA4Canvases(sourceCanvas) {
  const center = Math.floor(sourceCanvas.width / 2);
  const leftWidth = center;
  const rightX = center;
  const rightWidth = sourceCanvas.width - rightX;

  const leftCanvas = makeCanvas(leftWidth, sourceCanvas.height);
  const leftContext = leftCanvas.getContext("2d", { alpha: false });
  leftContext.fillStyle = PAGE_BG_COLOR;
  leftContext.fillRect(0, 0, leftCanvas.width, leftCanvas.height);
  leftContext.drawImage(sourceCanvas, 0, 0, leftWidth, sourceCanvas.height, 0, 0, leftWidth, sourceCanvas.height);

  const rightCanvas = makeCanvas(rightWidth, sourceCanvas.height);
  const rightContext = rightCanvas.getContext("2d", { alpha: false });
  rightContext.fillStyle = PAGE_BG_COLOR;
  rightContext.fillRect(0, 0, rightCanvas.width, rightCanvas.height);
  rightContext.drawImage(
    sourceCanvas,
    rightX,
    0,
    rightWidth,
    sourceCanvas.height,
    0,
    0,
    rightWidth,
    sourceCanvas.height
  );

  return [leftCanvas, rightCanvas];
}

async function renderSourceCanvas(pdfPage) {
  const sourceViewport = pdfPage.getViewport({ scale: 1 });
  const targetDisplayHeight = clamp(zoomSurfaceEl.clientHeight - 20, 420, 720);
  const displayScale = targetDisplayHeight / sourceViewport.height;
  const displayViewport = pdfPage.getViewport({ scale: displayScale });

  const renderScale = displayScale * getRenderDensity();
  const renderViewport = pdfPage.getViewport({ scale: renderScale });

  const canvas = makeCanvas(renderViewport.width, renderViewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = PAGE_BG_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({ canvasContext: context, viewport: renderViewport }).promise;

  return {
    canvas,
    sourceWidth: sourceViewport.width,
    sourceHeight: sourceViewport.height,
    displayWidth: displayViewport.width,
    displayHeight: displayViewport.height
  };
}

async function renderBookPages() {
  const physicalPages = [];
  const physicalPageMap = [];
  spreadCount = 0;

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
    const pdfPage = await pdfDoc.getPage(pageNumber);
    try {
      const rendered = await renderSourceCanvas(pdfPage);

      const forcePortrait = pageNumber === 1 || pageNumber === pdfDoc.numPages;
      const isLandscapeSource =
        !forcePortrait && rendered.sourceWidth > rendered.sourceHeight * LANDSCAPE_RATIO;

      if (isLandscapeSource) {
        const [leftCanvas, rightCanvas] = splitLandscapeToA4Canvases(rendered.canvas);
        spreadCount += 1;

        physicalPages.push({
          element: createPageElementFromCanvas(leftCanvas),
          width: rendered.displayWidth / 2,
          height: rendered.displayHeight
        });
        physicalPageMap.push(physicalPageMap.length + 1);

        physicalPages.push({
          element: createPageElementFromCanvas(rightCanvas),
          width: rendered.displayWidth / 2,
          height: rendered.displayHeight
        });
        physicalPageMap.push(physicalPageMap.length + 1);
        continue;
      }

      physicalPages.push({
        element: createPageElementFromCanvas(rendered.canvas),
        width: rendered.displayWidth,
        height: rendered.displayHeight
      });
      physicalPageMap.push(physicalPageMap.length + 1);
    } finally {
      pdfPage.cleanup();
    }
  }

  if (!physicalPages.length) {
    return { displayPages: [], pageMap: [] };
  }

  totalBookPages = physicalPages.length;
  pageWidth = Math.round(physicalPages[0].width);
  pageHeight = Math.round(physicalPages[0].height);

  const displayPages = [createBlankPageElement()];
  const map = [0];

  physicalPages.forEach((page, index) => {
    displayPages.push(page.element);
    map.push(physicalPageMap[index]);
  });

  if (displayPages.length % 2 !== 0) {
    displayPages.push(createBlankPageElement());
    map.push(0);
  }

  return { displayPages, pageMap: map };
}

function getStatusForDisplayIndex(index) {
  const pageNo = pageNumberMap[index] || 0;
  if (pageNo === 0) {
    for (let i = index; i >= 0; i -= 1) {
      if (pageNumberMap[i] > 0) {
        return `Page ${pageNumberMap[i]} / ${totalBookPages}`;
      }
    }
    for (let i = index + 1; i < pageNumberMap.length; i += 1) {
      if (pageNumberMap[i] > 0) {
        return `Page ${pageNumberMap[i]} / ${totalBookPages}`;
      }
    }
    return `Page 1 / ${totalBookPages}`;
  }
  return `Page ${pageNo} / ${totalBookPages}`;
}

function initFlipbook(displayPages, pageMap) {
  if (!displayPages.length) {
    throw new Error("No pages were rendered from the PDF.");
  }

  pageNumberMap = pageMap;

  pageFlip = new St.PageFlip(flipbookEl, {
    width: pageWidth,
    height: pageHeight,
    size: "stretch",
    minWidth: Math.max(170, Math.floor(pageWidth * 0.34)),
    maxWidth: Math.max(780, Math.floor(pageWidth * 1.95)),
    minHeight: Math.max(240, Math.floor(pageHeight * 0.44)),
    maxHeight: Math.max(980, Math.floor(pageHeight * 1.55)),
    showCover: false,
    drawShadow: false,
    maxShadowOpacity: 0,
    mobileScrollSupport: false,
    usePortrait: true,
    startPage: 1,
    swipeDistance: IS_COARSE_POINTER ? 28 : 44,
    clickEventForward: true,
    disableFlipByClick: false,
    showPageCorners: false,
    flippingTime: 560
  });

  pageFlip.loadFromHTML(displayPages);

  setStatus(
    `Loaded ${totalBookPages} book pages from ${pdfDoc.numPages} PDF pages (${spreadCount} A3 spreads split).`
  );

  pageFlip.on("flip", (event) => {
    setStatus(getStatusForDisplayIndex(event.data));
  });
}

async function rebuildFlipbook() {
  if (busy || !pdfDoc) {
    return;
  }

  busy = true;
  disableControls(true);
  setStatus("Rendering pages in high quality…");

  try {
    const previousDisplayIndex = pageFlip?.getCurrentPageIndex() ?? 1;
    clearFlipbook();

    const { displayPages, pageMap } = await renderBookPages();
    initFlipbook(displayPages, pageMap);
    resetGestureTransform();

    if (pageFlip && previousDisplayIndex > 0) {
      pageFlip.turnToPage(Math.min(previousDisplayIndex, pageFlip.getPageCount() - 1));
      setStatus(getStatusForDisplayIndex(pageFlip.getCurrentPageIndex()));
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not render PDF. Check that assets/magazine.pdf exists.");
  } finally {
    disableControls(false);
    busy = false;
  }
}

function closeInstructionPopup() {
  if (!instructionPopupEl) {
    return;
  }

  clearInterval(popupIntervalId);
  instructionPopupEl.classList.remove("is-visible");
}

function setFallbackFullscreen(active) {
  fullscreenFallbackActive = active;
  zoomSurfaceEl.classList.toggle("is-fullscreen-fallback", active);
  document.body.classList.toggle("has-fullscreen-fallback", active);
  fullscreenBtn.setAttribute("aria-pressed", String(active));
  fullscreenBtn.textContent = active ? "exit fullscreen" : "fullscreen";
}

function refreshFlipbookLayout() {
  if (!pageFlip) {
    return;
  }

  try {
    if (typeof pageFlip.update === "function") {
      pageFlip.update();
    }
  } catch (error) {
    console.warn("Flipbook layout refresh failed.", error);
  }
}

function toggleViewerFullscreen() {
  if (fullscreenFallbackActive) {
    setFallbackFullscreen(false);
    refreshFlipbookLayout();
    setTimeout(refreshFlipbookLayout, 140);
    return;
  }

  // Always use stable in-page fullscreen to avoid mobile blank-screen issues.
  setFallbackFullscreen(true);
  refreshFlipbookLayout();
  setTimeout(refreshFlipbookLayout, 160);
}

function showInstructionPopup() {
  if (!instructionPopupEl || !instructionCountdownEl) {
    return;
  }

  let remaining = 5;
  instructionCountdownEl.textContent = String(remaining);
  instructionPopupEl.classList.add("is-visible");

  clearInterval(popupIntervalId);
  popupIntervalId = setInterval(() => {
    remaining -= 1;
    instructionCountdownEl.textContent = String(Math.max(remaining, 0));

    if (remaining <= 0) {
      closeInstructionPopup();
    }
  }, 1000);
}

function preventPageZoomOutsideViewer() {
  const isInsideViewer = (event) => zoomSurfaceEl.contains(event.target);

  document.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length > 1 && !isInsideViewer(event)) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1 && !isInsideViewer(event)) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  // iOS Safari pinch events.
  document.addEventListener(
    "gesturestart",
    (event) => {
      if (!isInsideViewer(event)) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  document.addEventListener(
    "gesturechange",
    (event) => {
      if (!isInsideViewer(event)) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );

  // Desktop/browser zoom gesture fallback (e.g. ctrl + wheel).
  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey && !isInsideViewer(event)) {
        event.preventDefault();
      }
    },
    { passive: false, capture: true }
  );
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
        return;
      }

      if (event.touches.length === 1 && gestureState.scale > ZOOM_LOCK_THRESHOLD) {
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
  refreshFlipbookLayout();
});

window.addEventListener("orientationchange", () => {
  resetGestureTransform();
  setTimeout(refreshFlipbookLayout, 120);
  setTimeout(refreshFlipbookLayout, 520);
});

window.visualViewport?.addEventListener("resize", () => {
  refreshFlipbookLayout();
});

instructionCloseBtnEl?.addEventListener("click", closeInstructionPopup);
instructionPopupEl?.addEventListener("click", closeInstructionPopup);
fullscreenBtn?.addEventListener("click", toggleViewerFullscreen);

initTouchGestures();
preventPageZoomOutsideViewer();
showInstructionPopup();
loadPdf();
