/* ============================
   1-LINE EDIT (optional):
   Keep the filename the same and you won't need to touch this.
   ============================ */
const PDF_URL = "./assets/magazine.pdf";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.js";

const els = {
  status: document.getElementById("status"),
  bookWrap: document.getElementById("bookWrap"),
  book: document.getElementById("book"),

  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  zoomInBtn: document.getElementById("zoomInBtn"),
  zoomOutBtn: document.getElementById("zoomOutBtn"),

  fullscreenBtn: document.getElementById("fullscreenBtn"),
  shareBtn: document.getElementById("shareBtn"),
  downloadBtn: document.getElementById("downloadBtn"),

  pageNow: document.getElementById("pageNow"),
  pageTotal: document.getElementById("pageTotal"),
};

let pageFlip = null;
let pdfDoc = null;
let zoom = 1.0;

function setStatus(msg) {
  els.status.textContent = msg;
  els.status.hidden = false;
  els.bookWrap.hidden = true;
}

function showBook() {
  els.status.hidden = true;
  els.bookWrap.hidden = false;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function isFullscreen() {
  return !!document.fullscreenElement;
}

async function toggleFullscreen() {
  try {
    const target = els.bookWrap;
    if (!isFullscreen()) await target.requestFullscreen();
    else await document.exitFullscreen();
  } catch (e) {
    console.warn("Fullscreen not available:", e);
  }
}

function updateFullscreenIcon() {
  els.fullscreenBtn.textContent = isFullscreen() ? "🞬" : "⛶";
}

async function renderPdfToCanvases(pdf, renderScale) {
  const total = pdf.numPages;
  els.book.innerHTML = "";

  for (let i = 1; i <= total; i++) {
    setStatus(`Rendering page ${i} / ${total}…`);

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement("canvas");
    canvas.className = "pageCanvas";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const ctx = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: ctx, viewport }).promise;

    const pageDiv = document.createElement("div");
    pageDiv.appendChild(canvas);
    els.book.appendChild(pageDiv);
  }
}

function initFlipbook(totalPages) {
  if (pageFlip) {
    try { pageFlip.destroy(); } catch {}
    pageFlip = null;
  }

  const container = els.book;
  const isMobile = window.matchMedia("(max-width: 740px)").matches;

  pageFlip = new St.PageFlip(container, {
    width: 550,
    height: 700,
    size: "stretch",
    minWidth: 320,
    maxWidth: 2000,
    minHeight: 420,
    maxHeight: 2000,
    showCover: true,
    mobileScrollSupport: true,
    useMouseEvents: true,
    swipeDistance: 30,
    startPage: 0,
    drawShadow: true,
    flippingTime: 700,
    maxShadowOpacity: 0.35,
    autoSize: true,
    usePortrait: isMobile,
  });

  pageFlip.loadFromHTML(container.querySelectorAll(":scope > div"));

  els.pageTotal.textContent = String(totalPages);
  els.pageNow.textContent = "1";

  pageFlip.on("flip", (e) => {
    els.pageNow.textContent = String(e.data + 1);
  });

  els.prevBtn.onclick = () => pageFlip.flipPrev();
  els.nextBtn.onclick = () => pageFlip.flipNext();

  window.onkeydown = (e) => {
    if (!pageFlip) return;
    if (e.key === "ArrowLeft") pageFlip.flipPrev();
    if (e.key === "ArrowRight") pageFlip.flipNext();
  };

  window.addEventListener("resize", () => {
    if (!pageFlip) return;
    const mobileNow = window.matchMedia("(max-width: 740px)").matches;
    pageFlip.getSettings().usePortrait = mobileNow;
    pageFlip.update();
  });

  showBook();
}

async function load() {
  try {
    setStatus("Loading magazine…");

    pdfDoc = await pdfjsLib.getDocument({
      url: PDF_URL,
      withCredentials: false,
    }).promise;

    // download points directly at the PDF
    els.downloadBtn.href = PDF_URL;

    await renderPdfToCanvases(pdfDoc, zoom);
    initFlipbook(pdfDoc.numPages);
  } catch (err) {
    console.error(err);
    setStatus("Could not load the PDF. Make sure ./assets/magazine.pdf exists (case-sensitive) and is a valid PDF.");
  }
}

async function rerenderAt(newZoom) {
  if (!pdfDoc) return;
  zoom = clamp(newZoom, 0.75, 1.75);
  await renderPdfToCanvases(pdfDoc, zoom);
  initFlipbook(pdfDoc.numPages);
}

els.zoomInBtn.onclick = () => rerenderAt(zoom + 0.15);
els.zoomOutBtn.onclick = () => rerenderAt(zoom - 0.15);

els.fullscreenBtn.onclick = () => toggleFullscreen();
document.addEventListener("fullscreenchange", updateFullscreenIcon);
updateFullscreenIcon();

els.shareBtn.onclick = async () => {
  const shareData = {
    title: document.title || "Event Magazine",
    text: "Check out this magazine.",
    url: window.location.href, // shares the website link
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    // fallback: copy link
    await navigator.clipboard.writeText(shareData.url);
    setStatus("Link copied to clipboard.");
    setTimeout(() => showBook(), 900);
  } catch (e) {
    console.warn("Share failed:", e);
    try { prompt("Copy this link:", shareData.url); } catch {}
  }
};

load();