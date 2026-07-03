/* ============================================================
   RAGent · Biblioteca de conocimiento — lógica de la interfaz
   Todas las operaciones van contra la API ya publicada:
     - GET  /health
     - GET  /knowledge-source
     - POST /knowledge-source/{id}
     - POST /knowledge-source/{id}/points/from-json
     - POST /knowledge-source/{id}/points/from-html
     - POST /knowledge-source/{id}/search
     - GET  /v1/models
     - POST /v1/chat/completions
   ============================================================ */

"use strict";

const state = {
  sources: [],
  agents: [],
  selectedSourceId: null,
  chatMessages: [],
  htmlFile: null,
};

const $ = (selector) => document.querySelector(selector);

/* ------------------------ Utilidades ------------------------ */

function toast(message, kind = "info") {
  const container = $("#toast-container");
  const el = document.createElement("div");
  el.className = `toast${kind === "error" ? " toast-error" : kind === "ok" ? " toast-ok" : ""}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* respuestas sin cuerpo JSON */
  }
  if (!response.ok || (body && body.status === "error")) {
    const error = body && body.error ? body.error : null;
    const detail = body && body.detail ? body.detail : null;
    const message =
      (error && error.message) ||
      (typeof detail === "string" ? detail : null) ||
      `Error HTTP ${response.status}`;
    const err = new Error(message);
    err.payload = error || detail || body;
    throw err;
  }
  return body;
}

/* ------------------------ Navegación ------------------------ */

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${button.dataset.view}`).classList.add("active");
  });
});

function bindModeSwitch(buttons, panels) {
  buttons.forEach((buttonId, index) => {
    $(buttonId).addEventListener("click", () => {
      buttons.forEach((id) => $(id).classList.remove("active"));
      panels.forEach((id) => $(id).classList.remove("active"));
      $(buttonId).classList.add("active");
      $(panels[index]).classList.add("active");
    });
  });
}

bindModeSwitch(["#mode-direct", "#mode-agent"], ["#panel-direct", "#panel-agent"]);
bindModeSwitch(["#ingest-mode-json", "#ingest-mode-html"], ["#ingest-panel-json", "#ingest-panel-html"]);

/* ------------------------ Estado del servicio ------------------------ */

async function checkHealth() {
  const indicator = $("#health-indicator");
  try {
    await apiFetch("/health");
    indicator.className = "health health-ok";
    indicator.textContent = "● servicio operativo";
  } catch {
    indicator.className = "health health-error";
    indicator.textContent = "● servicio no disponible";
  }
}

/* ------------------------ Fuentes de conocimiento ------------------------ */

async function loadSources() {
  try {
    const body = await apiFetch("/knowledge-source");
    state.sources = body.result.items;
  } catch (err) {
    toast(`No se pudieron cargar las fuentes: ${err.message}`, "error");
    state.sources = [];
  }
  renderSidebarSources();
  renderDirectChips();
  renderManageSources();
  renderIngestSourceSelect();
}

function renderSidebarSources() {
  const list = $("#sidebar-source-list");
  if (!state.sources.length) {
    list.innerHTML = '<li class="muted">Sin fuentes disponibles</li>';
    return;
  }
  list.innerHTML = state.sources
    .map(
      (s) => `
        <li title="${escapeHtml(s.description)}">
          <span class="src-name">${escapeHtml(s.name)}</span>
          <span class="src-type">${escapeHtml(s.retrieval_type)}</span>
        </li>`
    )
    .join("");
}

function renderDirectChips() {
  const container = $("#direct-source-chips");
  if (!state.sources.length) {
    container.innerHTML = '<p class="muted">No hay fuentes disponibles.</p>';
    return;
  }
  if (!state.selectedSourceId || !state.sources.some((s) => s.id === state.selectedSourceId)) {
    state.selectedSourceId = state.sources[0].id;
  }
  container.innerHTML = state.sources
    .map(
      (s) => `
        <button type="button"
                class="chip${s.id === state.selectedSourceId ? " active" : ""}"
                data-source="${escapeHtml(s.id)}"
                title="${escapeHtml(s.description)}">
          ${escapeHtml(s.name)}
        </button>`
    )
    .join("");
  container.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.selectedSourceId = chip.dataset.source;
      renderDirectChips();
    });
  });
}

/* ------------------------ Búsqueda directa ------------------------ */

$("#direct-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("#direct-query").value.trim();
  const limit = Number($("#direct-limit").value);
  const results = $("#direct-results");

  if (!query || !state.selectedSourceId) return;

  results.innerHTML = '<div class="empty-state"><span class="spinner"></span> Buscando…</div>';

  try {
    const body = await apiFetch(
      `/knowledge-source/${encodeURIComponent(state.selectedSourceId)}/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
      }
    );
    renderSearchResults(body);
  } catch (err) {
    results.innerHTML = `<div class="error-state">⚠️ ${escapeHtml(err.message)}</div>`;
  }
});

function renderSearchResults(body) {
  const results = $("#direct-results");
  const { items, count, last_data_update: lastUpdate, query } = body.result;
  const sourceName =
    (state.sources.find((s) => s.id === body.knowledge_source_id) || {}).name ||
    body.knowledge_source_id;

  if (!count) {
    results.innerHTML = `
      <div class="empty-state">
        No se han encontrado documentos en <strong>${escapeHtml(sourceName)}</strong> para «${escapeHtml(query)}».
      </div>`;
    return;
  }

  const meta = `
    <div class="results-meta">
      <span><strong>${count}</strong> resultado${count === 1 ? "" : "s"} en <strong>${escapeHtml(sourceName)}</strong></span>
      ${lastUpdate ? `<span>· datos actualizados: ${escapeHtml(lastUpdate)}</span>` : ""}
    </div>`;

  const maxScore = Math.max(...items.map((item) => item.score), 0.0001);
  const cards = items
    .map((item, index) => {
      const width = Math.max(4, Math.round((item.score / maxScore) * 100));
      return `
        <article class="result-card">
          <div class="result-head">
            <span class="result-rank">Nº ${index + 1}</span>
            <span class="score">
              <span class="score-bar"><span style="width:${width}%"></span></span>
              ${item.score.toFixed(4)}
            </span>
          </div>
          <div class="result-content">${escapeHtml(item.content)}</div>
          <details>
            <summary>Metadatos</summary>
            <pre>${escapeHtml(JSON.stringify(item.metadata, null, 2))}</pre>
          </details>
        </article>`;
    })
    .join("");

  results.innerHTML = meta + cards;
}

/* ------------------------ Agentes / chat ------------------------ */

async function loadAgents() {
  const select = $("#agent-select");
  try {
    const body = await apiFetch("/v1/models");
    state.agents = body.data || [];
  } catch (err) {
    toast(`No se pudieron cargar los agentes: ${err.message}`, "error");
    state.agents = [];
  }
  if (!state.agents.length) {
    select.innerHTML = '<option value="">Sin agentes disponibles</option>';
    return;
  }
  select.innerHTML = state.agents
    .map((a) => `<option value="${escapeHtml(a.id)}" title="${escapeHtml(a.description)}">${escapeHtml(a.name)}</option>`)
    .join("");
}

function renderChat(pending = false) {
  const thread = $("#chat-thread");
  if (!state.chatMessages.length && !pending) {
    thread.innerHTML = `
      <div class="chat-empty">
        <span class="chat-empty-icon">🤖</span>
        <p>Pregunta lo que necesites: el agente consultará las fuentes de conocimiento y te responderá.</p>
      </div>`;
    return;
  }
  const bubbles = state.chatMessages
    .map((message) => {
      if (message.role === "error") {
        return `<div class="msg msg-error">⚠️ ${escapeHtml(message.content)}</div>`;
      }
      const cls = message.role === "user" ? "msg-user" : "msg-assistant";
      const meta =
        message.role === "assistant" && message.model
          ? `<div class="msg-meta">${escapeHtml(message.model)}${message.usage ? ` · ${message.usage.total_tokens} tokens` : ""}</div>`
          : "";
      return `<div class="msg ${cls}">${escapeHtml(message.content)}${meta}</div>`;
    })
    .join("");
  const typing = pending
    ? '<div class="msg msg-assistant msg-pending"><span class="typing-dots">Consultando la biblioteca</span></div>'
    : "";
  thread.innerHTML = bubbles + typing;
  thread.scrollTop = thread.scrollHeight;
}

$("#chat-clear").addEventListener("click", () => {
  state.chatMessages = [];
  renderChat();
});

$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const send = $("#chat-send");
  const content = input.value.trim();
  const model = $("#agent-select").value;

  if (!content) return;
  if (!model) {
    toast("No hay ningún agente disponible", "error");
    return;
  }

  state.chatMessages.push({ role: "user", content });
  input.value = "";
  input.style.height = "";
  send.disabled = true;
  renderChat(true);

  // Solo enviamos al backend los turnos válidos user/assistant
  const messages = state.chatMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const body = await apiFetch("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    const choice = body.choices && body.choices[0];
    state.chatMessages.push({
      role: "assistant",
      content: choice ? choice.message.content : "(respuesta vacía)",
      model: body.model,
      usage: body.usage,
    });
  } catch (err) {
    state.chatMessages.push({ role: "error", content: err.message });
  } finally {
    send.disabled = false;
    renderChat();
    input.focus();
  }
});

// Autoajuste de altura del textarea del chat
$("#chat-input").addEventListener("input", (event) => {
  const el = event.target;
  el.style.height = "";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
});

/* ------------------------ Gestión: catálogo ------------------------ */

function renderManageSources() {
  const container = $("#manage-source-list");
  if (!state.sources.length) {
    container.innerHTML = '<p class="muted">No hay fuentes disponibles.</p>';
    return;
  }
  container.innerHTML = state.sources
    .map(
      (s) => `
        <div class="manage-source">
          <div class="manage-source-head">
            <h4>${escapeHtml(s.name)}</h4>
            <button class="btn btn-ghost btn-small" data-create="${escapeHtml(s.id)}">Crear colección</button>
          </div>
          <p>${escapeHtml(s.description)}</p>
          <div class="manage-source-tags">
            <span class="tag">${escapeHtml(s.retrieval_type)}</span>
            <span class="tag tag-alt">colección: ${escapeHtml(s.collection_name)}</span>
          </div>
        </div>`
    )
    .join("");

  container.querySelectorAll("[data-create]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sourceId = button.dataset.create;
      button.disabled = true;
      button.textContent = "Creando…";
      try {
        const body = await apiFetch(`/knowledge-source/${encodeURIComponent(sourceId)}`, { method: "POST" });
        const created = body.result.collection_created;
        toast(
          created
            ? `Colección de «${sourceId}» creada correctamente`
            : `La colección de «${sourceId}» ya existía`,
          "ok"
        );
      } catch (err) {
        toast(`Error creando la colección: ${err.message}`, "error");
      } finally {
        button.disabled = false;
        button.textContent = "Crear colección";
      }
    });
  });
}

function renderIngestSourceSelect() {
  const select = $("#ingest-source");
  select.innerHTML = state.sources
    .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.id)})</option>`)
    .join("");
}

/* ------------------------ Gestión: ingesta JSON ------------------------ */

$("#ingest-json-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $("#ingest-json-text").value = await file.text();
  event.target.value = "";
});

$("#ingest-json-send").addEventListener("click", async () => {
  const button = $("#ingest-json-send");
  const sourceId = $("#ingest-source").value;
  const raw = $("#ingest-json-text").value.trim();

  if (!sourceId) return toast("Selecciona una fuente de destino", "error");
  if (!raw) return toast("El contenido JSON está vacío", "error");

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return showIngestResult(false, `El JSON no es válido: ${err.message}`);
  }
  if (!Array.isArray(data)) {
    return showIngestResult(false, "Los datos deben ser una lista JSON de objetos (por ejemplo: [ {…}, {…} ]).");
  }

  button.disabled = true;
  button.textContent = "Insertando…";
  try {
    const body = await apiFetch(
      `/knowledge-source/${encodeURIComponent(sourceId)}/points/from-json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );
    showIngestResult(
      true,
      `Ingesta completada en «${sourceId}»: ${body.result.points} punto(s) insertado(s)/actualizado(s).`,
      body.result.summary
    );
    toast("Datos insertados correctamente", "ok");
  } catch (err) {
    showIngestResult(false, err.message, err.payload);
  } finally {
    button.disabled = false;
    button.textContent = "Insertar datos";
  }
});

/* ------------------------ Gestión: ingesta HTML ------------------------ */

const dropzone = $("#html-dropzone");
const htmlInput = $("#ingest-html-file");

function setHtmlFile(file) {
  state.htmlFile = file || null;
  $("#html-dropzone-text").innerHTML = state.htmlFile
    ? `Fichero seleccionado:<br><strong>${escapeHtml(state.htmlFile.name)}</strong>`
    : "Arrastra aquí un fichero HTML<br>o haz clic para seleccionarlo";
  $("#ingest-html-send").disabled = !state.htmlFile;
}

htmlInput.addEventListener("change", () => setHtmlFile(htmlInput.files[0]));

["dragover", "dragenter"].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  })
);

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (file) setHtmlFile(file);
});

$("#ingest-html-send").addEventListener("click", async () => {
  const button = $("#ingest-html-send");
  const sourceId = $("#ingest-source").value;

  if (!sourceId) return toast("Selecciona una fuente de destino", "error");
  if (!state.htmlFile) return toast("Selecciona primero un fichero HTML", "error");

  const formData = new FormData();
  formData.append("file", state.htmlFile, state.htmlFile.name);

  button.disabled = true;
  button.textContent = "Subiendo…";
  try {
    const body = await apiFetch(
      `/knowledge-source/${encodeURIComponent(sourceId)}/points/from-html`,
      { method: "POST", body: formData }
    );
    showIngestResult(
      true,
      `Manual «${state.htmlFile.name}» ingerido en «${sourceId}»: ${body.result.points} punto(s).`,
      body.result.summary
    );
    toast("Manual subido correctamente", "ok");
    setHtmlFile(null);
  } catch (err) {
    showIngestResult(false, err.message, err.payload);
  } finally {
    button.disabled = false;
    button.textContent = "Subir manual";
  }
});

function showIngestResult(ok, message, details = null) {
  const container = $("#ingest-result");
  const hasDetails = details && Object.keys(details).length;
  container.innerHTML = `
    <div class="box ${ok ? "box-ok" : "box-error"}">
      ${ok ? "✔" : "⚠️"} ${escapeHtml(message)}
      ${hasDetails ? `<pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre>` : ""}
    </div>`;
}

/* ------------------------ Arranque ------------------------ */

checkHealth();
loadSources();
loadAgents();
setInterval(checkHealth, 60000);
