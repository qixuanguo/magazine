import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs";

const PDF_URL = "assets/magazine.pdf";
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.6;
const ZOOM_STEP = 0.2;

const flipbookEl = document.getElementById("flipbook");
const statusEl = document.getElementById("status");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const shareBtn = document.getElementById("shareBtn");
const downloadBtn = document.getElementById("downloadBtn");

let pdfDoc = null;
let pageFlip = null;
let zoom = 1;
let busy = false;

function setStatus(message) {
  statusEl.textContent = message;
}

function disableControls(disabled) {
  [prevBtn, nextBtn, zoomInBtn, zoomOutBtn, fullscreenBtn, shareBtn, downloadBtn].forEach((el) => {
    el.toggleAttribute("disabled", disabled);
    if (el.tagName === "A") {
      el.setAttribute("aria-disabled", String(disabled));
      el.style.pointerEvents = disabled ? "none" : "auto";
      el.style.opacity = disabled ? "0.65" : "1";
    }
  });
}

function clearFlipbook() {
  if (pageFlip) {
    pageFlip.destroy();
    pageFlip = null;
  }
  flipbookEl.innerHTML = "";
}

async function renderPdfPages() {
  const pages = [];
  const targetHeight = Math.max(640, flipbookEl.clientHeight - 20);

  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = (targetHeight / viewport.height) * zoom;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(scaledViewport.width);
    canvas.height = Math.floor(scaledViewport.height);

    const context = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;

    const pageEl = document.createElement("div");
    pageEl.className = "flip-page";
    pageEl.appendChild(canvas);
    pages.push(pageEl);
  }

  return pages;
}

function initFlipbook(pages) {
  const firstCanvas = pages[0]?.querySelector("canvas");
  if (!firstCanvas) {
    throw new Error("Failed to render PDF pages.");
  }

  const width = firstCanvas.width;
  const height = firstCanvas.height;

  pageFlip = new St.PageFlip(flipbookEl, {
    width,
    height,
    size: "stretch",
    minWidth: 280,
    minHeight: 320,
    maxShadowOpacity: 0.28,
    showCover: true,
    mobileScrollSupport: false,
    usePortrait: true,
    startPage: 0
  });

  pageFlip.loadFromHTML(pages);
  setStatus(`Page 1 / ${pdfDoc.numPages} | Zoom ${Math.round(zoom * 100)}%`);

  pageFlip.on("flip", (event) => {
    const current = event.data + 1;
    setStatus(`Page ${current} / ${pdfDoc.numPages} | Zoom ${Math.round(zoom * 100)}%`);
  });
}

async function rebuildFlipbook() {
  if (busy || !pdfDoc) {
    return;
  }
  busy = true;
  disableControls(true);
  setStatus(`Rendering pages at ${Math.round(zoom * 100)}%…`);

  try {
    const currentPageIndex = pageFlip?.getCurrentPageIndex() ?? 0;
    clearFlipbook();
    const pages = await renderPdfPages();
    initFlipbook(pages);

    if (currentPageIndex > 0) {
      pageFlip.turnToPage(Math.min(currentPageIndex, pdfDoc.numPages - 1));
    }
  } catch (error) {
    console.error(error);
    setStatus("Could not render PDF. Check that assets/magazine.pdf exists.");
  } finally {
    disableControls(false);
    busy = false;
  }
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

prevBtn.addEventListener("click", () => {
  pageFlip?.flipPrev();
});

nextBtn.addEventListener("click", () => {
  pageFlip?.flipNext();
});

zoomInBtn.addEventListener("click", async () => {
  if (zoom + ZOOM_STEP <= MAX_ZOOM) {
    zoom = Number((zoom + ZOOM_STEP).toFixed(2));
    await rebuildFlipbook();
  }
});

zoomOutBtn.addEventListener("click", async () => {
  if (zoom - ZOOM_STEP >= MIN_ZOOM) {
    zoom = Number((zoom - ZOOM_STEP).toFixed(2));
    await rebuildFlipbook();
  }
});

fullscreenBtn.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    await flipbookEl.requestFullscreen?.();
    fullscreenBtn.textContent = "Exit Fullscreen";
  } else {
    await document.exitFullscreen?.();
    fullscreenBtn.textContent = "Fullscreen";
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    fullscreenBtn.textContent = "Fullscreen";
  }
});

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
  }, 160);
});

loadPdf();
