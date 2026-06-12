import { useState, useEffect, useCallback, useRef } from "react";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SUPABASE-ZUGANGSDATEN — HIER DEINE WERTE EINTRAGEN                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const SUPABASE_URL = "https://lcyszggbgzqdrchavbpy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjeXN6Z2diZ3pxZHJjaGF2YnB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTg5OTcsImV4cCI6MjA5Njc5NDk5N30.U_wEj44tdbLvzzeQMo990CrVL8cqFEhj0wJEnpfxcdw";
// ────────────────────────────────────────────────────────────────────────────

// Supabase-Client dynamisch laden (kein npm-Install nötig)
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  if (!window.supabase) {
    await new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      sc.onload = res; sc.onerror = rej;
      document.head.appendChild(sc);
    });
  }
  _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

// ── Datenbank-Funktionen ──────────────────────────────────────────────────────
// Mapping zwischen App-Format (camelCase) und DB-Format (snake_case)
function belegToDb(b) {
  return {
    id: b.id, typ: b.typ, art: b.art, datum: b.datum,
    betrag: parseFloat(b.betrag) || 0,
    beschreibung: b.beschreibung || "", kategorie: b.kategorie || "",
    bereich: b.bereich || "unbekannt",
    bereich_begruendung: b.bereichBegruendung || "",
    image_url: b.imageUrl || null,
    ist_pdf: b.istPdf || false,
  };
}
function belegFromDb(r) {
  return {
    id: r.id, typ: r.typ, art: r.art, datum: r.datum,
    betrag: parseFloat(r.betrag).toFixed(2),
    beschreibung: r.beschreibung || "", kategorie: r.kategorie || "",
    bereich: r.bereich || "unbekannt",
    bereichBegruendung: r.bereich_begruendung || "",
    imageUrl: r.image_url || null,
    image: r.image_url || null, // für Anzeige
    istPdf: r.ist_pdf || false,
  };
}

async function dbLadeBelege() {
  const sb = await getSupabase();
  const { data, error } = await sb.from("belege").select("*").order("datum", { ascending: true });
  if (error) { console.error("Laden fehlgeschlagen:", error); return []; }
  return (data || []).map(belegFromDb);
}

async function dbSpeichereBeleg(b) {
  const sb = await getSupabase();
  const { error } = await sb.from("belege").upsert(belegToDb(b));
  if (error) throw error;
}

async function dbLoescheBeleg(id, imageUrl) {
  const sb = await getSupabase();
  // Zuerst die Datei aus dem Storage entfernen (falls vorhanden)
  if (imageUrl) {
    try {
      // Internen Pfad aus der öffentlichen URL extrahieren
      // URL-Form: .../storage/v1/object/public/belege/<PFAD>
      const marker = "/storage/v1/object/public/belege/";
      const idx = imageUrl.indexOf(marker);
      if (idx !== -1) {
        const pfad = decodeURIComponent(imageUrl.substring(idx + marker.length));
        await sb.storage.from("belege").remove([pfad]);
      }
    } catch (e) {
      console.warn("Storage-Datei konnte nicht gelöscht werden:", e);
      // Trotzdem weitermachen und den DB-Eintrag löschen
    }
  }
  // Dann den Datenbank-Eintrag löschen
  const { error } = await sb.from("belege").delete().eq("id", id);
  if (error) throw error;
}

// Foto in Supabase Storage hochladen → gibt öffentliche URL zurück
async function dbUploadDatei(typ, datum, beschreibung, dataUrl, istPdf) {
  const sb = await getSupabase();
  const jahr = (datum || "").slice(0, 4) || "" + new Date().getFullYear();
  const safeName = (beschreibung || "beleg").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40);
  const ext = istPdf ? "pdf" : "jpg";
  const mime = istPdf ? "application/pdf" : "image/jpeg";
  const path = `${typ}/${jahr}/${datum}_${safeName}_${Date.now()}.${ext}`;
  // dataUrl → Blob
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const { error } = await sb.storage.from("belege").upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from("belege").getPublicUrl(path);
  return data.publicUrl;
}

// ── Konstanten ────────────────────────────────────────────────────────────────
const BEREICHE = {
  ideell:     { label: "Ideeller Bereich",                 icon: "🎯", color: "#085041", bg: "#E1F5EE", border: "#5DCAA5" },
  vermoegen:  { label: "Vermögensverwaltung",               icon: "🏠", color: "#0C447C", bg: "#E6F1FB", border: "#85B7EB" },
  zweck:      { label: "Zweckbetrieb",                      icon: "⚽", color: "#633806", bg: "#FAEEDA", border: "#FAC775" },
  wirtschaft: { label: "Wirtschaftl. Geschäftsbetrieb",     icon: "🎉", color: "#791F1F", bg: "#FCEBEB", border: "#F09595" },
  unbekannt:  { label: "Nicht zugeordnet",                  icon: "❓", color: "#666",    bg: "#F0EDE6", border: "#ccc"    },
};

const CURRENT_YEAR = new Date().getFullYear();
// Jahre von 2022 bis 3 Jahre in die Zukunft, erweitert sich automatisch jedes Jahr
const YEARS = Array.from({ length: (CURRENT_YEAR + 3) - 2022 + 1 }, (_, i) => 2022 + i);
const today = () => new Date().toISOString().split("T")[0];
const fmt = (n) => (parseFloat(n) || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

async function storageGet(key) {
  try { const r = await window.storage.get(key); return r?.value ? JSON.parse(r.value) : null; } catch { return null; }
}
async function storageSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

// ── Bestätigungs-Dialog (ersetzt window.confirm, das auf Netlify blockiert ist) ─
function ConfirmDialog({ message, onYes, onNo }) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 340, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 15, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)", background: "#f7f5f0", cursor: "pointer", fontSize: 13, fontWeight: 500 }} onClick={onNo}>Abbrechen</button>
          <button style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #f7c1c1", background: "#fcebeb", color: "#a32d2d", cursor: "pointer", fontSize: 13, fontWeight: 500 }} onClick={onYes}>Löschen</button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  app:         { maxWidth: 900, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif", color: "#1a1a18" },
  header:      { display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "14px 18px", background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.1)", flexWrap: "wrap" },
  tabs:        { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" },
  tab:         { flex: 1, minWidth: 80, padding: "10px 6px", textAlign: "center", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, cursor: "pointer", background: "#fff", fontSize: 13, color: "#666", userSelect: "none" },
  tabActive:   { background: "#e6f1fb", borderColor: "#b5d4f4", color: "#185fa5", fontWeight: 500 },
  tabKb:       { background: "#eaf3de", borderColor: "#c0dd97", color: "#3b6d11", fontWeight: 500 },
  tabAbgleich: { background: "#faeeda", borderColor: "#fac775", color: "#854f0b", fontWeight: 500 },
  card:        { background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.1)", padding: 18, marginBottom: 14 },
  sectionTitle:{ fontSize: 15, fontWeight: 500, marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  btn:         { display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.2)", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#1a1a18" },
  btnPrimary:  { background: "#e6f1fb", borderColor: "#b5d4f4", color: "#185fa5" },
  btnSuccess:  { background: "#eaf3de", borderColor: "#c0dd97", color: "#3b6d11" },
  btnDanger:   { background: "#fcebeb", borderColor: "#f7c1c1", color: "#a32d2d" },
  btnWarning:  { background: "#faeeda", borderColor: "#fac775", color: "#854f0b" },
  btnSm:       { padding: "4px 9px", fontSize: 12 },
  input:       { padding: "7px 9px", border: "1px solid rgba(0,0,0,0.2)", borderRadius: 8, fontSize: 13, background: "#fff", color: "#1a1a18", fontFamily: "inherit", width: "100%" },
  label:       { fontSize: 11, color: "#666", display: "block", marginBottom: 3 },
  row:         { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 },
  col:         { display: "flex", flexDirection: "column", flex: 1, minWidth: 110 },
};

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────
function BereichBadge({ bereich, small }) {
  const b = BEREICHE[bereich] || BEREICHE.unbekannt;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: small ? "1px 6px" : "2px 8px", borderRadius: 12, fontSize: small ? 10 : 11, fontWeight: 500, whiteSpace: "nowrap", background: b.bg, color: b.color, border: `1px solid ${b.border}` }}>
      {b.icon} {b.label}
    </span>
  );
}

function FotoButton({ onFile, label = "📷 Foto aufnehmen / hochladen" }) {
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div style={{ ...s.btn, ...s.btnPrimary, pointerEvents: "none" }}>{label}</div>
      <input type="file" accept="image/*"
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onFile(f); }}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 }} />
    </div>
  );
}

function PdfButton({ onFile, label = "📄 PDF hochladen" }) {
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <div style={{ ...s.btn, ...s.btnWarning, pointerEvents: "none" }}>{label}</div>
      <input type="file" accept="application/pdf"
        onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) onFile(f); }}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 }} />
    </div>
  );
}

// ── Beleg-Formular ────────────────────────────────────────────────────────────
function BelegForm({ typ, prefill, image, pdfFile, onSave, onCancel }) {
  const [form, setForm] = useState({
    datum: prefill?.datum || today(),
    betrag: prefill?.betrag || "",
    art: prefill?.art || "ausgabe",
    beschreibung: prefill?.beschreibung || (pdfFile?.name ? pdfFile.name.replace(/\.pdf$/i, "") : ""),
    kategorie: prefill?.kategorie || "",
    bereich: prefill?.bereich || "unbekannt",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ padding: 12, background: "#f7f5f0", borderRadius: 10, marginTop: 12 }}>
      <div style={s.row}>
        <div style={s.col}><label style={s.label}>Datum</label><input style={s.input} type="date" value={form.datum} onChange={e => set("datum", e.target.value)} /></div>
        <div style={s.col}><label style={s.label}>Betrag (€)</label><input style={s.input} type="number" step="0.01" placeholder="0,00" value={form.betrag} onChange={e => set("betrag", e.target.value)} /></div>
        <div style={s.col}><label style={s.label}>Art</label>
          <select style={s.input} value={form.art} onChange={e => set("art", e.target.value)}>
            <option value="ausgabe">Ausgabe</option>
            <option value="einnahme">Einnahme</option>
          </select>
        </div>
      </div>
      <div style={s.row}>
        <div style={{ ...s.col, flex: 2 }}><label style={s.label}>Beschreibung</label><input style={s.input} type="text" placeholder="Wofür?" value={form.beschreibung} onChange={e => set("beschreibung", e.target.value)} /></div>
        <div style={s.col}><label style={s.label}>Kategorie</label><input style={s.input} type="text" placeholder="z.B. Mitgliedsbeitrag" value={form.kategorie} onChange={e => set("kategorie", e.target.value)} /></div>
      </div>
      <div style={{ ...s.col, marginBottom: 10 }}>
        <label style={s.label}>Steuerlicher Bereich</label>
        <select style={s.input} value={form.bereich} onChange={e => set("bereich", e.target.value)}>
          {Object.entries(BEREICHE).filter(([k]) => k !== "unbekannt").map(([k, v]) =>
            <option key={k} value={k}>{v.icon} {v.label}</option>)}
          <option value="unbekannt">❓ Nicht zugeordnet</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button style={{ ...s.btn, ...s.btnSuccess }} onClick={() => {
          if (!form.betrag || parseFloat(form.betrag) <= 0) { alert("Bitte Betrag eingeben."); return; }
          onSave({ ...form, betrag: parseFloat(form.betrag).toFixed(2), image: image || null, pdfDataUrl: pdfFile?.dataUrl || null, pdfName: pdfFile?.name || null });
        }}>✓ Beleg speichern</button>
        <button style={s.btn} onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── Scan-Editor: Zuschneiden + Kontrast vor der KI-Analyse ────────────────────
function ScanEditor({ imageUrl, onConfirm, onCancel }) {
  const [crop, setCrop] = useState({ x: 8, y: 8, w: 84, h: 84 }); // Prozent
  const [contrast, setContrast] = useState(1.0);
  const [brightness, setBrightness] = useState(1.0);
  const [grayscale, setGrayscale] = useState(false);
  const [drag, setDrag] = useState(null);
  const imgWrapRef = useRef(null);
  const imgRef = useRef(null);

  // Zieh-Logik für die vier Ecken und das Verschieben
  const onPointerDown = (handle) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = imgWrapRef.current.getBoundingClientRect();
    setDrag({ handle, rect, startX: (e.touches ? e.touches[0].clientX : e.clientX), startY: (e.touches ? e.touches[0].clientY : e.clientY), startCrop: { ...crop } });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = ((cx - drag.startX) / drag.rect.width) * 100;
      const dy = ((cy - drag.startY) / drag.rect.height) * 100;
      setCrop(() => {
        let { x, y, w, h } = drag.startCrop;
        if (drag.handle === "move") {
          x = Math.max(0, Math.min(100 - w, x + dx));
          y = Math.max(0, Math.min(100 - h, y + dy));
        } else {
          if (drag.handle.includes("l")) { const nx = Math.max(0, Math.min(x + w - 10, x + dx)); w += x - nx; x = nx; }
          if (drag.handle.includes("r")) { w = Math.max(10, Math.min(100 - x, w + dx)); }
          if (drag.handle.includes("t")) { const ny = Math.max(0, Math.min(y + h - 10, y + dy)); h += y - ny; y = ny; }
          if (drag.handle.includes("b")) { h = Math.max(10, Math.min(100 - y, h + dy)); }
        }
        return { x, y, w, h };
      });
    };
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, [drag]);

  // Zuschneiden + Filter anwenden, volle Auflösung beibehalten
  const applyAndConfirm = () => {
    const img = imgRef.current;
    const natW = img.naturalWidth, natH = img.naturalHeight;
    const sx = (crop.x / 100) * natW;
    const sy = (crop.y / 100) * natH;
    const sw = (crop.w / 100) * natW;
    const sh = (crop.h / 100) * natH;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx.filter = `contrast(${contrast}) brightness(${brightness}) ${grayscale ? "grayscale(1)" : ""}`;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    // Hohe JPG-Qualität (0.95) für bessere KI-Lesbarkeit
    const result = canvas.toDataURL("image/jpeg", 0.95);
    onConfirm(result);
  };

  const handleStyle = { position: "absolute", width: 22, height: 22, background: "#fff", border: "2px solid #185fa5", borderRadius: "50%", touchAction: "none", cursor: "pointer", zIndex: 3 };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 10 }}>
        Ziehe den Rahmen genau auf die Belegkanten. Mit den Reglern kannst du blasse Kassenbons lesbarer machen.
      </div>
      <div ref={imgWrapRef} style={{ position: "relative", width: "100%", userSelect: "none", touchAction: "none", borderRadius: 8, overflow: "hidden", background: "#000" }}>
        <img ref={imgRef} src={imageUrl} style={{ width: "100%", display: "block", filter: `contrast(${contrast}) brightness(${brightness}) ${grayscale ? "grayscale(1)" : ""}` }} draggable={false} />
        {/* Abdunklung außerhalb des Crops */}
        <div style={{ position: "absolute", inset: 0, boxShadow: `0 0 0 9999px rgba(0,0,0,0.45)`, clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${crop.x}% ${crop.y}%, ${crop.x}% ${crop.y + crop.h}%, ${crop.x + crop.w}% ${crop.y + crop.h}%, ${crop.x + crop.w}% ${crop.y}%, ${crop.x}% ${crop.y}%)`, pointerEvents: "none" }} />
        {/* Crop-Rahmen */}
        <div
          onMouseDown={onPointerDown("move")} onTouchStart={onPointerDown("move")}
          style={{ position: "absolute", left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%`, border: "2px solid #185fa5", boxSizing: "border-box", cursor: "move", touchAction: "none", zIndex: 2 }}>
          {/* Raster-Linien (Drittel) */}
          <div style={{ position: "absolute", left: "33.3%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.4)" }} />
          <div style={{ position: "absolute", left: "66.6%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.4)" }} />
          <div style={{ position: "absolute", top: "33.3%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.4)" }} />
          <div style={{ position: "absolute", top: "66.6%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.4)" }} />
        </div>
        {/* Eck-Griffe */}
        <div onMouseDown={onPointerDown("tl")} onTouchStart={onPointerDown("tl")} style={{ ...handleStyle, left: `calc(${crop.x}% - 11px)`, top: `calc(${crop.y}% - 11px)` }} />
        <div onMouseDown={onPointerDown("tr")} onTouchStart={onPointerDown("tr")} style={{ ...handleStyle, left: `calc(${crop.x + crop.w}% - 11px)`, top: `calc(${crop.y}% - 11px)` }} />
        <div onMouseDown={onPointerDown("bl")} onTouchStart={onPointerDown("bl")} style={{ ...handleStyle, left: `calc(${crop.x}% - 11px)`, top: `calc(${crop.y + crop.h}% - 11px)` }} />
        <div onMouseDown={onPointerDown("br")} onTouchStart={onPointerDown("br")} style={{ ...handleStyle, left: `calc(${crop.x + crop.w}% - 11px)`, top: `calc(${crop.y + crop.h}% - 11px)` }} />
      </div>

      {/* Regler */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#666", minWidth: 75 }}>Kontrast</span>
          <input type="range" min="0.5" max="2.5" step="0.05" value={contrast} onChange={e => setContrast(parseFloat(e.target.value))} style={{ flex: 1 }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#666", minWidth: 75 }}>Helligkeit</span>
          <input type="range" min="0.5" max="2" step="0.05" value={brightness} onChange={e => setBrightness(parseFloat(e.target.value))} style={{ flex: 1 }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#666", cursor: "pointer" }}>
          <input type="checkbox" checked={grayscale} onChange={e => setGrayscale(e.target.checked)} />
          Schwarz-Weiß (oft besser für Kassenbons)
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={{ ...s.btn, ...s.btnSm }} onClick={() => { setContrast(1.6); setBrightness(1.1); setGrayscale(true); }}>✨ Auto für Kassenbon</button>
          <button style={{ ...s.btn, ...s.btnSm }} onClick={() => { setContrast(1.0); setBrightness(1.0); setGrayscale(false); }}>Zurücksetzen</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
        <button style={{ ...s.btn, ...s.btnSuccess }} onClick={applyAndConfirm}>✓ Scan übernehmen & auslesen</button>
        <button style={s.btn} onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── Erfassen-Karte ────────────────────────────────────────────────────────────
function ErfassenKarte({ typ, onSaved }) {
  const [mode, setMode] = useState("idle"); // idle | choose | scan | pdf-ready | manual | ocr-loading | ocr-done
  const [rawImage, setRawImage] = useState(null);
  const [image, setImage] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);   // { dataUrl, name }
  const [ocrData, setOcrData] = useState(null);
  const [ocrError, setOcrError] = useState(false);

  // Foto gewählt → in den Scan-Editor
  const handleFotoFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => { setRawImage(e.target.result); setMode("scan"); };
    reader.readAsDataURL(file);
  }, []);

  // PDF gewählt → direkt zum Formular (PDF kann nicht gescannt werden)
  const handlePdfFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => { setPdfFile({ dataUrl: e.target.result, name: file.name }); setMode("pdf-ready"); };
    reader.readAsDataURL(file);
  }, []);

  // Nach dem Zuschneiden → KI-Analyse (versucht; fällt bei Fehler auf manuell zurück)
  const runOcr = useCallback(async (dataUrl) => {
    setImage(dataUrl);
    setMode("ocr-loading");
    try {
      const b64 = dataUrl.split(",")[1];
      const mt = dataUrl.split(";")[0].split(":")[1];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 600,
          system: "Du bist Kassenbuch-Assistent für einen gemeinnützigen Sportverein. Bereiche: ideell(Mitgliedsbeiträge,Spenden,Zuschüsse), vermoegen(Zinsen,Kapitalerträge,Miete/Pacht), zweck(Eintrittsgelder,Startgelder,Kursgebühren), wirtschaft(Vereinsfest,Sponsoring,Merchandise). Antworte NUR mit JSON, keine Backticks.",
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mt, data: b64 } },
            { type: "text", text: 'JSON: {"datum":"JJJJ-MM-TT","betrag":"0.00","art":"ausgabe","beschreibung":"...","kategorie":"...","bereich":"ideell|vermoegen|zweck|wirtschaft|unbekannt","bereichBegruendung":"..."}' }
          ]}]
        })
      });
      const data = await res.json();
      const txt = (data.content || []).map(c => c.text || "").join("").replace(/```json|```/g, "").trim();
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch {}
      setOcrData(parsed); setOcrError(!parsed);
    } catch { setOcrData(null); setOcrError(true); }
    setMode("ocr-done");
  }, []);

  const reset = () => { setMode("idle"); setRawImage(null); setImage(null); setPdfFile(null); setOcrData(null); setOcrError(false); };
  const handleSave = (formData) => { onSaved({ ...formData, typ, id: Date.now().toString(), createdAt: new Date().toISOString() }); reset(); };

  return (
    <div style={s.card}>
      <div style={s.sectionTitle}>{typ === "bank" ? "🏦 Bank" : "💵 Kasse"} — Beleg erfassen</div>

      {mode === "idle" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => setMode("choose")}>📎 Dokument hochladen</button>
          <button style={s.btn} onClick={() => setMode("manual")}>+ Manuell erfassen</button>
        </div>
      )}

      {mode === "choose" && (
        <div>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>Was möchtest du hochladen?</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ position: "relative", display: "inline-block" }}>
              <div style={{ ...s.btn, ...s.btnPrimary, pointerEvents: "none" }}>📷 Foto</div>
              <input type="file" accept="image/*"
                onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handleFotoFile(f); }}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 }} />
            </div>
            <div style={{ position: "relative", display: "inline-block" }}>
              <div style={{ ...s.btn, ...s.btnWarning, pointerEvents: "none" }}>📄 PDF</div>
              <input type="file" accept="application/pdf"
                onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handlePdfFile(f); }}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", fontSize: 0 }} />
            </div>
            <button style={s.btn} onClick={reset}>Abbrechen</button>
          </div>
        </div>
      )}

      {mode === "scan" && rawImage && (
        <ScanEditor imageUrl={rawImage} onConfirm={runOcr} onCancel={reset} />
      )}

      {mode === "pdf-ready" && pdfFile && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#faeeda", border: "1px solid #fac775", borderRadius: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{pdfFile.name}</div>
              <div style={{ fontSize: 12, color: "#666" }}>PDF bereit — bitte Daten unten eintragen</div>
            </div>
          </div>
          <BelegForm typ={typ} pdfFile={pdfFile} onSave={handleSave} onCancel={reset} />
        </>
      )}

      {mode === "manual" && <BelegForm typ={typ} onSave={handleSave} onCancel={reset} />}

      {(mode === "ocr-loading" || mode === "ocr-done") && (
        <>
          {image && <div style={{ textAlign: "center", marginBottom: 12 }}><img src={image} style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)" }} /></div>}
          {mode === "ocr-loading" && (
            <div style={{ background: "#faeeda", border: "1px solid #fac775", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ fontWeight: 500, fontSize: 12, color: "#854f0b" }}>⏳ Beleg wird verarbeitet…</div>
            </div>
          )}
          {mode === "ocr-done" && ocrData && (
            <>
              <div style={{ background: "#faeeda", border: "1px solid #fac775", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ fontWeight: 500, fontSize: 12, color: "#854f0b" }}>✓ KI-Ergebnis — bitte prüfen</div>
                <div style={{ fontSize: 12, color: "#666" }}>Datum: <b>{ocrData.datum}</b> · Betrag: <b>{ocrData.betrag} €</b> · {ocrData.beschreibung}</div>
              </div>
              {ocrData.bereich && ocrData.bereich !== "unbekannt" && (
                <div style={{ borderRadius: 10, padding: "10px 12px", marginBottom: 12, border: `1px solid ${BEREICHE[ocrData.bereich]?.border}`, background: BEREICHE[ocrData.bereich]?.bg }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: BEREICHE[ocrData.bereich]?.color }}>{BEREICHE[ocrData.bereich]?.icon} KI-Vorschlag: {BEREICHE[ocrData.bereich]?.label}</div>
                  <div style={{ fontSize: 12, color: "#666", lineHeight: 1.5 }}>{ocrData.bereichBegruendung}</div>
                </div>
              )}
              <BelegForm typ={typ} prefill={ocrData} image={image} onSave={handleSave} onCancel={reset} />
            </>
          )}
          {mode === "ocr-done" && ocrError && (
            <>
              <div style={{ background: "#e6f1fb", border: "1px solid #b5d4f4", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#185fa5" }}>Bitte die Belegdaten unten eintragen. Das Foto wird mitgespeichert.</div>
              <BelegForm typ={typ} image={image} onSave={handleSave} onCancel={reset} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Beleg-Detail ──────────────────────────────────────────────────────────────
function BelegDetail({ beleg, onUpdate, onDelete, onShowImg }) {
  const [form, setForm] = useState({ ...beleg });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ padding: "12px 0 0", borderTop: "1px solid rgba(0,0,0,0.08)", marginTop: 8, width: "100%" }} onClick={e => e.stopPropagation()}>
      <div style={s.row}>
        <div style={s.col}><label style={s.label}>Datum</label><input style={s.input} type="date" value={form.datum} onChange={e => set("datum", e.target.value)} /></div>
        <div style={s.col}><label style={s.label}>Betrag (€)</label><input style={s.input} type="number" step="0.01" value={form.betrag} onChange={e => set("betrag", e.target.value)} /></div>
        <div style={s.col}><label style={s.label}>Art</label>
          <select style={s.input} value={form.art} onChange={e => set("art", e.target.value)}>
            <option value="einnahme">Einnahme</option><option value="ausgabe">Ausgabe</option>
          </select>
        </div>
      </div>
      <div style={s.row}>
        <div style={{ ...s.col, flex: 2 }}><label style={s.label}>Beschreibung</label><input style={s.input} type="text" value={form.beschreibung || ""} onChange={e => set("beschreibung", e.target.value)} /></div>
        <div style={s.col}><label style={s.label}>Kategorie</label><input style={s.input} type="text" value={form.kategorie || ""} onChange={e => set("kategorie", e.target.value)} /></div>
      </div>
      <div style={{ ...s.col, marginBottom: 10 }}>
        <label style={s.label}>Steuerlicher Bereich</label>
        <select style={s.input} value={form.bereich || "unbekannt"} onChange={e => set("bereich", e.target.value)}>
          {Object.entries(BEREICHE).filter(([k]) => k !== "unbekannt").map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          <option value="unbekannt">❓ Nicht zugeordnet</option>
        </select>
      </div>
      {beleg.bereichBegruendung && <div style={{ fontSize: 12, color: "#666", background: "#f7f5f0", borderRadius: 7, padding: "7px 10px", marginBottom: 8 }}>🤖 KI-Begründung: {beleg.bereichBegruendung}</div>}
      {beleg.image && beleg.istPdf && (
        <div style={{ marginBottom: 10 }}>
          <a href={beleg.image} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#faeeda", border: "1px solid #fac775", borderRadius: 8, textDecoration: "none", color: "#854f0b", fontSize: 13, fontWeight: 500 }}>
            📄 PDF öffnen
          </a>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>Öffnet das Dokument in einem neuen Tab</div>
        </div>
      )}
      {beleg.image && !beleg.istPdf && (
        <div style={{ marginBottom: 10 }}>
          <img src={beleg.image} style={{ maxWidth: 180, borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)", cursor: "pointer" }} onClick={() => onShowImg(beleg.image)} />
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>Klicken zum Vergrößern</div>
        </div>
      )}
      <div style={{ display: "flex", gap: 7 }}>
        <button style={{ ...s.btn, ...s.btnSuccess, ...s.btnSm }} onClick={() => onUpdate(form)}>✓ Speichern</button>
        <button style={{ ...s.btn, ...s.btnDanger, ...s.btnSm }} onClick={onDelete}>🗑 Löschen</button>
      </div>
    </div>
  );
}

// ── Beleg-Liste ───────────────────────────────────────────────────────────────
function BelegListe({ typ, belege, year, onUpdate, onDelete, highlightId }) {
  const [expandedId, setExpandedId] = useState(highlightId || null);
  const [search, setSearch] = useState("");
  const [filterArt, setFilterArt] = useState("");
  const [filterBereich, setFilterBereich] = useState("");
  const [imgOverlay, setImgOverlay] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // {id, beschreibung}

  const filtered = belege
    .filter(b => b.typ === typ && b.datum?.startsWith("" + year))
    .filter(b => !filterArt || b.art === filterArt)
    .filter(b => !filterBereich || (b.bereich || "unbekannt") === filterBereich)
    .filter(b => !search || JSON.stringify(b).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.datum > b.datum ? 1 : -1);

  const ein = filtered.filter(b => b.art === "einnahme").reduce((s, b) => s + parseFloat(b.betrag || 0), 0);
  const aus = filtered.filter(b => b.art === "ausgabe").reduce((s, b) => s + parseFloat(b.betrag || 0), 0);

  const askDelete = (id, beschreibung) => setConfirmDelete({ id, beschreibung });
  const doDelete = () => { onDelete(confirmDelete.id); setExpandedId(null); setConfirmDelete(null); };

  return (
    <>
      {confirmDelete && (
        <ConfirmDialog
          message={`Beleg „${confirmDelete.beschreibung}" wirklich löschen? Dies kann nicht rückgängig gemacht werden.`}
          onYes={doDelete}
          onNo={() => setConfirmDelete(null)}
        />
      )}
      {imgOverlay && (
        <div onClick={() => setImgOverlay(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, cursor: "pointer" }}>
          <img src={imgOverlay} style={{ maxWidth: "90%", maxHeight: "85%", borderRadius: 8 }} />
          <div style={{ position: "absolute", top: 16, right: 20, color: "#fff", fontSize: 22 }}>✕</div>
        </div>
      )}
      <div style={s.card}>
        <div style={s.sectionTitle}>
          {typ === "bank" ? "🏦" : "💵"} Belege {year}
          <span style={{ fontSize: 12, fontWeight: 400, color: "#666" }}>({filtered.length})</span>
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 400 }}>
            <span style={{ color: "#3b6d11" }}>+{fmt(ein)}</span>{" / "}<span style={{ color: "#a32d2d" }}>-{fmt(aus)}</span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 7, marginBottom: 10, flexWrap: "wrap" }}>
          <input style={{ ...s.input, flex: 1, minWidth: 100 }} placeholder="🔍 Suche…" value={search} onChange={e => setSearch(e.target.value)} />
          <select style={{ ...s.input, width: "auto" }} value={filterArt} onChange={e => setFilterArt(e.target.value)}>
            <option value="">Alle Arten</option><option value="einnahme">Einnahmen</option><option value="ausgabe">Ausgaben</option>
          </select>
          <select style={{ ...s.input, width: "auto" }} value={filterBereich} onChange={e => setFilterBereich(e.target.value)}>
            <option value="">Alle Bereiche</option>
            {Object.entries(BEREICHE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        {filtered.length === 0
          ? <div style={{ textAlign: "center", padding: 28, color: "#aaa", fontSize: 13 }}>Noch keine Belege für {year}</div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered.map(b => {
                const exp = expandedId === b.id;
                const isHighlighted = highlightId === b.id;
                return (
                  <div key={b.id} id={"bi-" + b.id} style={{ padding: "10px 12px", background: exp ? "#fff" : isHighlighted ? "#fffbe6" : "#f7f5f0", borderRadius: 10, border: exp ? "1px solid #b5d4f4" : isHighlighted ? "1px solid #fac775" : "1px solid transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer", flexWrap: "wrap", minWidth: 0 }} onClick={() => setExpandedId(exp ? null : b.id)}>
                        <span style={{ fontSize: 12, color: "#666", minWidth: 82 }}>{b.datum}</span>
                        <span style={{ padding: "2px 7px", borderRadius: 12, fontSize: 11, fontWeight: 500, background: b.art === "einnahme" ? "#eaf3de" : "#fcebeb", color: b.art === "einnahme" ? "#3b6d11" : "#a32d2d" }}>{b.art === "einnahme" ? "+" : "−"}</span>
                        <span style={{ flex: 1, fontSize: 13, minWidth: 80 }}>{b.beschreibung || "–"}</span>
                        <BereichBadge bereich={b.bereich || "unbekannt"} small />
                        <span style={{ fontSize: 14, fontWeight: 500, minWidth: 80, textAlign: "right", color: b.art === "einnahme" ? "#3b6d11" : "#a32d2d" }}>{b.art === "einnahme" ? "+" : "−"}{fmt(b.betrag)}</span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>{exp ? "▲" : "▼"}</span>
                      </div>
                      <button
                        style={{ ...s.btn, ...s.btnDanger, ...s.btnSm, flexShrink: 0 }}
                        onClick={(e) => { e.stopPropagation(); askDelete(b.id, b.beschreibung || b.datum); }}>
                        🗑
                      </button>
                    </div>
                    {exp && <BelegDetail beleg={b} onUpdate={(u) => { onUpdate({ ...b, ...u }); setExpandedId(null); }} onDelete={() => askDelete(b.id, b.beschreibung || b.datum)} onShowImg={setImgOverlay} />}
                  </div>
                );
              })}
            </div>
        }
      </div>
    </>
  );
}

// ── Abgleich ──────────────────────────────────────────────────────────────────
function Abgleich({ belege, year, onBelegSaved, onGotoBeleg }) {
  const [abgleichTyp, setAbgleichTyp] = useState("bank");
  const [status, setStatus] = useState("idle");
  const [kontoTransaktionen, setKontoTransaktionen] = useState([]);
  const [pdfName, setPdfName] = useState("");
  const [erfasseFor, setErfasseFor] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const resetAbgleich = () => { setPdfName(""); setStatus("idle"); setKontoTransaktionen([]); setErfasseFor(null); setConfirmReset(false); };

  // Matching: Betrag exakt gleich (auf 2 Stellen gerundet), Datum ±5 Tage
  const belegeDesTyps = belege.filter(b => b.typ === abgleichTyp && b.datum?.startsWith("" + year));

  function findMatchingBeleg(transaktion) {
    const tBetrag = Math.round(parseFloat(transaktion.betrag) * 100);
    const tDatum = new Date(transaktion.datum);
    return belegeDesTyps.find(b => {
      const bBetrag = Math.round(parseFloat(b.betrag) * 100);
      if (bBetrag !== tBetrag) return false;
      const bDatum = new Date(b.datum);
      const diffDays = Math.abs((tDatum - bDatum) / (1000 * 60 * 60 * 24));
      return diffDays <= 5;
    });
  }

  async function handlePdf(file) {
    setPdfName(file.name);
    setStatus("loading");
    setKontoTransaktionen([]);
    setErfasseFor(null);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });

      const systemPrompt = abgleichTyp === "bank"
        ? `Du bist Buchführungs-Assistent für einen gemeinnützigen Sportverein. 
Analysiere den Kontoauszug (Bank) und liste ALLE Buchungen auf.
Bank = alle Transaktionen über das Vereinskonto (Überweisungen, Lastschriften, Gutschriften).
Antworte NUR mit einem JSON-Array, keine Backticks, kein erklärender Text.`
        : `Du bist Buchführungs-Assistent für einen gemeinnützigen Sportverein.
Analysiere das Kassenbuch oder den Kassenbeleg (Kasse) und liste ALLE Buchungen auf.
Kasse = alle Barzahlungen und Bareinnahmen.
Antworte NUR mit einem JSON-Array, keine Backticks, kein erklärender Text.`;

      const userPrompt = `Extrahiere alle Buchungen aus diesem Dokument.
Gib ein JSON-Array zurück, jede Buchung als Objekt:
[{"datum":"JJJJ-MM-TT","betrag":"0.00","art":"ausgabe","verwendungszweck":"..."}]
art ist "einnahme" oder "ausgabe". betrag immer positiv.
Falls Datum fehlt, schätze es anhand des Kontoauszugszeitraums.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: "user", content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            { type: "text", text: userPrompt }
          ]}]
        })
      });
      const data = await res.json();
      const txt = (data.content || []).map(c => c.text || "").join("").replace(/```json|```/g, "").trim();
      let parsed = [];
      try { parsed = JSON.parse(txt); } catch {}
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Keine Buchungen gefunden");
      // Nur Buchungen im gewählten Jahr
      const filtered = parsed.filter(t => t.datum?.startsWith("" + year));
      setKontoTransaktionen(filtered.length > 0 ? filtered : parsed);
      setStatus("done");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  const matches = kontoTransaktionen.map(t => ({ ...t, matchedBeleg: findMatchingBeleg(t) }));
  const fehlend = matches.filter(m => !m.matchedBeleg);
  const vorhanden = matches.filter(m => m.matchedBeleg);

  return (
    <div>
      {/* Typ-Auswahl */}
      <div style={s.card}>
        <div style={s.sectionTitle}>🔍 Kontoauszug / Kassenbuch abgleichen</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            style={{ ...s.btn, ...(abgleichTyp === "bank" ? s.btnPrimary : {}) }}
            onClick={() => { setAbgleichTyp("bank"); setStatus("idle"); setKontoTransaktionen([]); setErfasseFor(null); }}>
            🏦 Bank-Kontoauszug
          </button>
          <button
            style={{ ...s.btn, ...(abgleichTyp === "kasse" ? s.btnWarning : {}) }}
            onClick={() => { setAbgleichTyp("kasse"); setStatus("idle"); setKontoTransaktionen([]); setErfasseFor(null); }}>
            💵 Kassenbuch
          </button>
        </div>

        <div style={{ fontSize: 13, color: "#666", marginBottom: 12, padding: "10px 12px", background: "#f7f5f0", borderRadius: 8 }}>
          {abgleichTyp === "bank"
            ? "Lade deinen Bank-Kontoauszug als PDF hoch. Die KI liest alle Buchungen aus und vergleicht sie mit deinen erfassten Bankbelegen."
            : "Lade dein Kassenbuch als PDF hoch. Die KI liest alle Einträge aus und vergleicht sie mit deinen erfassten Kassenbelegen."}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <PdfButton
            onFile={handlePdf}
            label={abgleichTyp === "bank" ? "📄 Kontoauszug (PDF) hochladen" : "📄 Kassenbuch (PDF) hochladen"}
          />
          {pdfName && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#f7f5f0", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)" }}>
              <span style={{ fontSize: 12, color: "#666" }}>📎 {pdfName}</span>
              <button style={{ ...s.btn, ...s.btnDanger, ...s.btnSm }} onClick={() => setConfirmReset(true)}>
                🗑 Entfernen
              </button>
            </div>
          )}
          {confirmReset && (
            <ConfirmDialog
              message={`„${pdfName}" entfernen und Abgleich zurücksetzen?`}
              onYes={resetAbgleich}
              onNo={() => setConfirmReset(false)}
            />
          )}
        </div>
      </div>

      {/* Ladeindikator */}
      {status === "loading" && (
        <div style={{ ...s.card, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>KI liest {abgleichTyp === "bank" ? "Kontoauszug" : "Kassenbuch"} aus…</div>
          <div style={{ fontSize: 13, color: "#666" }}>Alle Buchungen werden erkannt und mit deinen Belegen abgeglichen</div>
        </div>
      )}

      {/* Fehler */}
      {status === "error" && (
        <div style={{ ...s.card, background: "#fcebeb", border: "1px solid #f7c1c1" }}>
          <div style={{ fontWeight: 500, color: "#a32d2d", marginBottom: 4 }}>❌ PDF konnte nicht ausgelesen werden</div>
          <div style={{ fontSize: 13, color: "#666" }}>Stelle sicher dass das PDF einen lesbaren Text enthält (kein reines Scan-Bild ohne OCR). Versuche es erneut.</div>
        </div>
      )}

      {/* Ergebnis */}
      {status === "done" && (
        <>
          {/* Zusammenfassung */}
          <div style={{ ...s.card, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 140, borderRadius: 10, padding: "12px 14px", background: fehlend.length === 0 ? "#eaf3de" : "#fcebeb", border: `1px solid ${fehlend.length === 0 ? "#c0dd97" : "#f7c1c1"}` }}>
              <div style={{ fontSize: 11, color: fehlend.length === 0 ? "#3b6d11" : "#a32d2d", marginBottom: 4 }}>❌ Fehlende Belege</div>
              <div style={{ fontSize: 26, fontWeight: 500, color: fehlend.length === 0 ? "#3b6d11" : "#a32d2d" }}>{fehlend.length}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>Buchung ohne Beleg</div>
            </div>
            <div style={{ flex: 1, minWidth: 140, borderRadius: 10, padding: "12px 14px", background: "#eaf3de", border: "1px solid #c0dd97" }}>
              <div style={{ fontSize: 11, color: "#3b6d11", marginBottom: 4 }}>✓ Abgeglichen</div>
              <div style={{ fontSize: 26, fontWeight: 500, color: "#3b6d11" }}>{vorhanden.length}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>Beleg vorhanden</div>
            </div>
            <div style={{ flex: 1, minWidth: 140, borderRadius: 10, padding: "12px 14px", background: "#f7f5f0", border: "1px solid #ccc" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>📄 Buchungen gesamt</div>
              <div style={{ fontSize: 26, fontWeight: 500, color: "#1a1a18" }}>{matches.length}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>im {abgleichTyp === "bank" ? "Kontoauszug" : "Kassenbuch"}</div>
            </div>
          </div>

          {/* Fehlende Belege */}
          {fehlend.length > 0 && (
            <div style={s.card}>
              <div style={{ ...s.sectionTitle, color: "#a32d2d" }}>❌ Fehlende Belege ({fehlend.length})</div>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                Diese Buchungen aus dem {abgleichTyp === "bank" ? "Kontoauszug" : "Kassenbuch"} haben keinen zugehörigen Beleg. Bitte suche und erfasse den jeweiligen Beleg.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {fehlend.map((t, i) => (
                  <div key={i} style={{ borderRadius: 10, border: "1px solid #f7c1c1", background: erfasseFor === i ? "#fff" : "#fff8f8", padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "#666", fontWeight: 500 }}>{t.datum}</span>
                          <span style={{ padding: "2px 7px", borderRadius: 12, fontSize: 11, fontWeight: 500, background: t.art === "einnahme" ? "#eaf3de" : "#fcebeb", color: t.art === "einnahme" ? "#3b6d11" : "#a32d2d" }}>{t.art === "einnahme" ? "Einnahme" : "Ausgabe"}</span>
                          <span style={{ fontSize: 15, fontWeight: 500, color: t.art === "einnahme" ? "#3b6d11" : "#a32d2d" }}>{t.art === "einnahme" ? "+" : "−"}{fmt(t.betrag)}</span>
                        </div>
                        <div style={{ fontSize: 13, color: "#1a1a18", marginBottom: 4 }}>{t.verwendungszweck || "–"}</div>
                        <div style={{ fontSize: 11, color: "#a32d2d", fontWeight: 500 }}>
                          🔍 Suche nach: Beleg vom {t.datum} über {fmt(t.betrag)} — „{t.verwendungszweck}"
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {erfasseFor !== i && (
                          <button style={{ ...s.btn, ...s.btnSuccess, ...s.btnSm }} onClick={() => setErfasseFor(i)}>
                            + Beleg jetzt erfassen
                          </button>
                        )}
                      </div>
                    </div>

                    {erfasseFor === i && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                        <div style={{ fontSize: 12, color: "#854f0b", fontWeight: 500, marginBottom: 8 }}>📋 Beleg für diese Buchung erfassen — Daten sind vorausgefüllt:</div>
                        <BelegForm
                          typ={abgleichTyp}
                          prefill={{ datum: t.datum, betrag: t.betrag, art: t.art, beschreibung: t.verwendungszweck }}
                          onSave={(formData) => {
                            onBelegSaved({ ...formData, typ: abgleichTyp, id: Date.now().toString(), createdAt: new Date().toISOString() });
                            setErfasseFor(null);
                          }}
                          onCancel={() => setErfasseFor(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vorhandene Belege */}
          {vorhanden.length > 0 && (
            <div style={s.card}>
              <div style={{ ...s.sectionTitle, color: "#3b6d11" }}>✓ Abgeglichene Buchungen ({vorhanden.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {vorhanden.map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f4fbee", borderRadius: 10, border: "1px solid #c0dd97", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 18 }}>✓</span>
                    <span style={{ fontSize: 12, color: "#666", minWidth: 82 }}>{t.datum}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{t.verwendungszweck || "–"}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: t.art === "einnahme" ? "#3b6d11" : "#a32d2d" }}>{t.art === "einnahme" ? "+" : "−"}{fmt(t.betrag)}</span>
                    <button style={{ ...s.btn, ...s.btnSm, fontSize: 11 }} onClick={() => onGotoBeleg(t.matchedBeleg.id, t.matchedBeleg.typ)}>
                      → Beleg ansehen
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Kassenbuch ────────────────────────────────────────────────────────────────
function Kassenbuch({ belege, year, onGoto }) {
  const [anfang, setAnfangState] = useState(0);
  const [anfangInput, setAnfangInput] = useState("0");

  // Kassenbuch = ausschließlich Kassenbelege (bar). Bankbelege gehören zu den Kontoauszügen.
  const all = belege.filter(b => b.typ === "kasse" && b.datum?.startsWith("" + year)).sort((a, b) => a.datum > b.datum ? 1 : -1);
  const bs = {};
  Object.keys(BEREICHE).forEach(k => { bs[k] = { ein: 0, aus: 0, n: 0 }; });
  all.forEach(b => {
    const br = b.bereich || "unbekannt";
    bs[br].n++;
    if (b.art === "einnahme") bs[br].ein += parseFloat(b.betrag || 0);
    else bs[br].aus += parseFloat(b.betrag || 0);
  });

  let saldo = anfang;
  const rows = all.map(b => { saldo += (b.art === "einnahme" ? 1 : -1) * parseFloat(b.betrag || 0); return { ...b, saldo }; });
  const end = saldo;

  const exportCSV = () => {
    let csv = "Datum;Art;Steuerlicher Bereich;Beschreibung;Kategorie;Betrag\n";
    csv += `${year}-01-01;;Anfangsbestand;;${anfang.toFixed(2)}\n`;
    all.forEach(b => { const br = BEREICHE[b.bereich || "unbekannt"]; csv += `${b.datum};${b.art};"${br.label}";"${(b.beschreibung || "").replace(/"/g, '""')}";${b.kategorie || ""};${b.art === "einnahme" ? "" : "-"}${parseFloat(b.betrag).toFixed(2)}\n`; });
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); a.download = `Kassenbuch_${year}.csv`; a.click();
  };

  const exportPDF = () => {
    let s2 = anfang;
    const sr = ["ideell", "vermoegen", "zweck", "wirtschaft"].map(k => { const br = BEREICHE[k], b = bs[k]; return `<tr><td>${br.label}</td><td style="text-align:right;color:green">+${b.ein.toFixed(2)} €</td><td style="text-align:right;color:red">-${b.aus.toFixed(2)} €</td><td style="text-align:right;font-weight:bold">${(b.ein - b.aus).toFixed(2)} €</td></tr>`; }).join("");
    const rr = all.map(b => { s2 += (b.art === "einnahme" ? 1 : -1) * parseFloat(b.betrag || 0); const br = BEREICHE[b.bereich || "unbekannt"]; return `<tr><td>${b.datum}</td><td>${br.label}</td><td>${b.beschreibung || ""}</td><td style="text-align:right;color:${b.art === "einnahme" ? "green" : "red"}">${b.art === "einnahme" ? "+" : "-"}${parseFloat(b.betrag).toFixed(2)} €</td><td style="text-align:right">${s2.toFixed(2)} €</td></tr>`; }).join("");
    const w = window.open("", "_blank");
    w.document.write(`<html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;font-size:11px;padding:20px}h1{font-size:17px}h2{font-size:13px;margin:14px 0 5px;border-bottom:1px solid #ccc}table{width:100%;border-collapse:collapse}th,td{padding:5px 7px;border-bottom:1px solid #eee}th{background:#f5f5f5}tfoot td{font-weight:bold;border-top:2px solid #333}</style></head><body><h1>Kassenbuch ${year} (Barbelege)</h1><p style="font-size:11px;color:#666">Erstellt: ${new Date().toLocaleDateString("de-DE")} · Kassenanfangsbestand: ${anfang.toFixed(2)} €</p><h2>Steuerliche Bereiche</h2><table><thead><tr><th>Bereich</th><th>Einnahmen</th><th>Ausgaben</th><th>Saldo</th></tr></thead><tbody>${sr}</tbody></table><h2>Alle Kassenbelege chronologisch</h2><table><thead><tr><th>Datum</th><th>Bereich</th><th>Beschreibung</th><th>Betrag</th><th>Kassensaldo</th></tr></thead><tbody><tr><td>${year}-01-01</td><td></td><td>Kassenanfangsbestand</td><td></td><td>${anfang.toFixed(2)} €</td></tr>${rr}</tbody><tfoot><tr><td colspan="4">Kassenendbestand</td><td>${s2.toFixed(2)} €</td></tr></tfoot></table></body></html>`);
    w.document.close(); w.print();
  };

  return (
    <>
      <div style={s.card}>
        <div style={s.sectionTitle}>📄 Kassenbuch {year}</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 12, padding: "8px 12px", background: "#faeeda", borderRadius: 8, border: "1px solid #fac775" }}>
          💵 Nur Barbelege (Kasse) — Bankbuchungen sind in den Kontoauszügen
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={s.col}><label style={s.label}>Anfangsbestand (€)</label>
            <input style={{ ...s.input, maxWidth: 200 }} type="number" step="0.01" value={anfangInput}
              onChange={e => setAnfangInput(e.target.value)}
              onBlur={e => setAnfangState(parseFloat(e.target.value) || 0)} />
          </div>
          <button style={{ ...s.btn, ...s.btnSuccess }} onClick={exportPDF}>📄 PDF</button>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={exportCSV}>📊 CSV</button>
        </div>
      </div>
      <div style={s.card}>
        <div style={s.sectionTitle}>Übersicht nach steuerlichen Bereichen</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 8 }}>
          {["ideell", "vermoegen", "zweck", "wirtschaft"].map(k => {
            const br = BEREICHE[k], b = bs[k];
            return (<div key={k} style={{ borderRadius: 10, padding: "12px 14px", border: `1px solid ${br.border}`, background: br.bg }}>
              <div style={{ fontSize: 11, color: br.color, marginBottom: 4 }}>{br.icon} {br.label}</div>
              <div style={{ fontSize: 17, fontWeight: 500, color: br.color }}>{fmt(b.ein - b.aus)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>+{fmt(b.ein)} / -{fmt(b.aus)} · {b.n} Belege</div>
            </div>);
          })}
          {bs.unbekannt.n > 0 && (
            <div style={{ borderRadius: 10, padding: "12px 14px", border: "1px solid #ccc", background: "#f7f5f0" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>❓ Nicht zugeordnet</div>
              <div style={{ fontSize: 17, fontWeight: 500, color: "#666" }}>{bs.unbekannt.n} Belege</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Bitte manuell zuordnen</div>
            </div>
          )}
        </div>
      </div>
      <div style={s.card}>
        <div style={s.sectionTitle}>Chronologisches Kassenbuch</div>
        <div style={{ display: "flex", padding: "4px 0 8px", borderBottom: "2px solid rgba(0,0,0,0.1)", fontSize: 11, color: "#666", gap: 8 }}>
          <span style={{ minWidth: 85 }}>Datum</span><span style={{ minWidth: 130 }}>Bereich</span><span style={{ flex: 1 }}>Beschreibung</span><span style={{ minWidth: 85, textAlign: "right" }}>Betrag</span><span style={{ minWidth: 85, textAlign: "right" }}>Kassensaldo</span>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.07)", fontSize: 13 }}>
          <span style={{ minWidth: 85, fontSize: 12, color: "#666" }}>{year}-01-01</span><span style={{ minWidth: 130 }} /><span style={{ flex: 1, fontWeight: 500 }}>Kassenanfangsbestand</span><span style={{ minWidth: 85 }} /><span style={{ minWidth: 85, textAlign: "right", fontWeight: 500, color: "#3b6d11" }}>{fmt(anfang)}</span>
        </div>
        {rows.map(b => (
          <div key={b.id} style={{ display: "flex", gap: 8, padding: "7px 0", borderBottom: "1px solid rgba(0,0,0,0.07)", fontSize: 13, cursor: "pointer" }} onClick={() => onGoto(b.id, b.typ)}>
            <span style={{ minWidth: 85, fontSize: 12, color: "#666" }}>{b.datum}</span>
            <span style={{ minWidth: 130 }}><BereichBadge bereich={b.bereich || "unbekannt"} small /></span>
            <span style={{ flex: 1 }}>{b.beschreibung || "–"}{b.kategorie ? <span style={{ fontSize: 11, color: "#aaa" }}> ({b.kategorie})</span> : null}</span>
            <span style={{ minWidth: 85, textAlign: "right", fontWeight: 500, color: b.art === "einnahme" ? "#3b6d11" : "#a32d2d" }}>{b.art === "einnahme" ? "+" : "−"}{fmt(b.betrag)}</span>
            <span style={{ minWidth: 85, textAlign: "right", fontWeight: 500, color: b.saldo >= 0 ? "#3b6d11" : "#a32d2d" }}>{fmt(b.saldo)}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, padding: "10px 0 4px", borderTop: "2px solid rgba(0,0,0,0.15)", fontSize: 14, fontWeight: 500 }}>
          <span style={{ minWidth: 85 }} /><span style={{ minWidth: 130 }} /><span style={{ flex: 1 }}>Kassenendbestand</span><span style={{ minWidth: 85 }} /><span style={{ minWidth: 85, textAlign: "right", color: end >= 0 ? "#3b6d11" : "#a32d2d" }}>{fmt(end)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, padding: "14px 16px", borderRadius: 10, background: end >= 0 ? "#eaf3de" : "#fcebeb", border: `1px solid ${end >= 0 ? "#c0dd97" : "#f7c1c1"}` }}>
          <div>
            <div style={{ fontSize: 13, color: "#666" }}>Kassenendbestand {year}</div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{all.length} Kassenbelege · +{fmt(all.filter(b => b.art === "einnahme").reduce((s, b) => s + parseFloat(b.betrag || 0), 0))} · −{fmt(all.filter(b => b.art === "ausgabe").reduce((s, b) => s + parseFloat(b.betrag || 0), 0))}</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, color: end >= 0 ? "#3b6d11" : "#a32d2d" }}>{fmt(end)}</div>
        </div>
      </div>
    </>
  );
}

// ── Login / Anmeldung ─────────────────────────────────────────────────────────
function Login({ onLoggedIn }) {
  const [modus, setModus] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [fehler, setFehler] = useState("");
  const [info, setInfo] = useState("");

  const handleSubmit = async () => {
    if (!email.trim() || !passwort) { setFehler("Bitte E-Mail und Passwort eingeben."); setStatus("error"); return; }
    setStatus("loading"); setFehler(""); setInfo("");
    try {
      const sb = await getSupabase();
      if (modus === "login") {
        const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password: passwort });
        if (error) throw error;
        onLoggedIn(data.user);
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password: passwort });
        if (error) throw error;
        if (data.user && !data.session) {
          setInfo("Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben. Danach kannst du dich anmelden.");
          setStatus("idle");
          setModus("login");
        } else {
          onLoggedIn(data.user);
        }
      }
    } catch (e) {
      setFehler(e.message === "Invalid login credentials" ? "E-Mail oder Passwort falsch." : (e.message || "Anmeldung fehlgeschlagen."));
      setStatus("error");
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.1)", padding: 28, maxWidth: 380, width: "100%", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💰</div>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Vereinskasse</h1>
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{modus === "login" ? "Bitte anmelden" : "Neues Konto erstellen"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={s.label}>E-Mail</label>
            <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@verein.de"
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          <div>
            <label style={s.label}>Passwort</label>
            <input style={s.input} type="password" value={passwort} onChange={e => setPasswort(e.target.value)} placeholder="••••••••"
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>

          {fehler && <div style={{ fontSize: 13, color: "#a32d2d", background: "#fcebeb", border: "1px solid #f7c1c1", borderRadius: 8, padding: "8px 12px" }}>{fehler}</div>}
          {info && <div style={{ fontSize: 13, color: "#3b6d11", background: "#eaf3de", border: "1px solid #c0dd97", borderRadius: 8, padding: "8px 12px" }}>{info}</div>}

          <button style={{ ...s.btn, ...s.btnPrimary, justifyContent: "center", padding: "10px", marginTop: 4, opacity: status === "loading" ? 0.6 : 1 }}
            onClick={handleSubmit} disabled={status === "loading"}>
            {status === "loading" ? "⏳ Bitte warten…" : modus === "login" ? "🔑 Anmelden" : "✓ Konto erstellen"}
          </button>

          <div style={{ textAlign: "center", fontSize: 12, color: "#aaa", marginTop: 6 }}>
            Zugang nur für berechtigte Vereinsmitglieder. Bei Problemen wende dich an den Kassenwart.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Haupt-App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("bank");
  const [year, setYear] = useState(CURRENT_YEAR);
  const [belege, setBelege] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [syncError, setSyncError] = useState("");

  // Beim Start: prüfen ob bereits angemeldet
  useEffect(() => {
    getSupabase().then(async (sb) => {
      const { data } = await sb.auth.getSession();
      if (data?.session?.user) setUser(data.session.user);
      setAuthChecked(true);
      // Auf Login/Logout reagieren
      sb.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user || null);
      });
    }).catch(() => setAuthChecked(true));
  }, []);

  // Wenn angemeldet: Belege aus DB laden
  useEffect(() => {
    if (!user) { setBelege([]); setLoaded(false); return; }
    setLoaded(false);
    dbLadeBelege().then(data => { setBelege(data); setLoaded(true); }).catch(() => { setLoaded(true); });
  }, [user]);

  // Beleg speichern (mit Foto-Upload zu Supabase Storage)
  const addBeleg = async (b) => {
    setSyncError("");
    try {
      let imageUrl = null;
      let istPdf = false;
      if (b.pdfDataUrl && b.pdfDataUrl.startsWith("data:")) {
        // PDF hochladen
        imageUrl = await dbUploadDatei(b.typ, b.datum, b.beschreibung, b.pdfDataUrl, true);
        istPdf = true;
      } else if (b.image && b.image.startsWith("data:")) {
        // Foto hochladen
        imageUrl = await dbUploadDatei(b.typ, b.datum, b.beschreibung, b.image, false);
      }
      const belegMitUrl = { ...b, imageUrl, image: imageUrl, istPdf };
      await dbSpeichereBeleg(belegMitUrl);
      setBelege(prev => [...prev, belegMitUrl]);
    } catch (e) {
      console.error(e);
      setSyncError("Beleg konnte nicht gespeichert werden: " + (e.message || "Unbekannter Fehler"));
    }
  };

  const updateBeleg = async (u) => {
    setSyncError("");
    try {
      await dbSpeichereBeleg(u);
      setBelege(prev => prev.map(b => b.id === u.id ? u : b));
    } catch (e) {
      setSyncError("Änderung konnte nicht gespeichert werden: " + (e.message || ""));
    }
  };

  const deleteBeleg = async (id) => {
    setSyncError("");
    try {
      const beleg = belege.find(b => b.id === id);
      await dbLoescheBeleg(id, beleg?.imageUrl || beleg?.image || null);
      setBelege(prev => prev.filter(b => b.id !== id));
    } catch (e) {
      setSyncError("Beleg konnte nicht gelöscht werden: " + (e.message || ""));
    }
  };

  const handleLogout = async () => {
    const sb = await getSupabase();
    await sb.auth.signOut();
    setUser(null);
  };

  const gotoBeleg = (id, typ) => {
    setTab(typ);
    setTimeout(() => document.getElementById("bi-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  };

  const tabStyle = (t) => ({
    ...s.tab,
    ...(t === tab
      ? t === "kassenbuch" ? s.tabKb
      : t === "abgleich" ? s.tabAbgleich
      : s.tabActive
      : {})
  });

  // Noch nicht geprüft ob angemeldet
  if (!authChecked) return <div style={{ padding: 32, textAlign: "center", color: "#666" }}>Wird geladen…</div>;

  // Nicht angemeldet → Login zeigen
  if (!user) return <Login onLoggedIn={setUser} />;

  // Angemeldet, aber Belege laden noch
  if (!loaded) return <div style={{ padding: 32, textAlign: "center", color: "#666" }}>Belege werden geladen…</div>;

  return (
    <div style={s.app}>
      <div style={s.header}>
        <div style={{ fontSize: 22 }}>💰</div>
        <h1 style={{ fontSize: 19, fontWeight: 500, flex: 1, margin: 0 }}>Vereinskasse</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "#eaf3de", borderRadius: 20, fontSize: 12, color: "#3b6d11" }}>
          👤 {user.email}
        </div>
        <span style={{ fontSize: 13, color: "#666", background: "#f0ede6", padding: "4px 10px", borderRadius: 20 }}>Jahr {year}</span>
        <select style={{ ...s.input, width: "auto" }} value={year} onChange={e => setYear(parseInt(e.target.value))}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button style={{ ...s.btn, ...s.btnSm }} onClick={handleLogout}>Abmelden</button>
      </div>

      {syncError && (
        <div style={{ background: "#fcebeb", border: "1px solid #f7c1c1", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontSize: 13, color: "#a32d2d" }}>
          ⚠️ {syncError}
        </div>
      )}

      <div style={s.tabs}>
        <div style={tabStyle("bank")} onClick={() => setTab("bank")}>🏦 Bank</div>
        <div style={tabStyle("kasse")} onClick={() => setTab("kasse")}>💵 Kasse</div>
        <div style={tabStyle("kassenbuch")} onClick={() => setTab("kassenbuch")}>📄 Kassenbuch</div>
        <div style={tabStyle("abgleich")} onClick={() => setTab("abgleich")}>🔍 Abgleich</div>
      </div>

      {tab === "bank" && (<><ErfassenKarte typ="bank" onSaved={addBeleg} /><BelegListe typ="bank" belege={belege} year={year} onUpdate={updateBeleg} onDelete={deleteBeleg} /></>)}
      {tab === "kasse" && (<><ErfassenKarte typ="kasse" onSaved={addBeleg} /><BelegListe typ="kasse" belege={belege} year={year} onUpdate={updateBeleg} onDelete={deleteBeleg} /></>)}
      {tab === "kassenbuch" && <Kassenbuch belege={belege} year={year} onGoto={gotoBeleg} />}
      {tab === "abgleich" && <Abgleich belege={belege} year={year} onBelegSaved={addBeleg} onGotoBeleg={gotoBeleg} />}
    </div>
  );
}
