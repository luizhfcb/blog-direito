import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, orderBy, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CLOUDINARY_CLOUD_NAME = 'doeuhqxdp';
const CLOUDINARY_UPLOAD_PRESET = 'direito_pdfs';

const firebaseConfig = {
  apiKey: "AIzaSyC_uXZGdcRD0JSvr8C5TIfjojnoFs3V_gA",
  authDomain: "direito-em-rosa.firebaseapp.com",
  projectId: "direito-em-rosa",
  storageBucket: "direito-em-rosa.firebasestorage.app",
  messagingSenderId: "329471222814",
  appId: "1:329471222814:web:87bcbb81a9165d87a3fa0f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let allPosts = [];
let isAdmin = false;

let browseType = null;
let browseArea = null;

let formType = 'resumo';
let contentMode = 'texto';
let selectedPdfFile = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeStoredText(value) {
  if (typeof value !== 'string') return '';

  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '');
}

function formatTextAsHtml(value) {
  const plainText = normalizeStoredText(value).trim();
  if (!plainText) return '';

  return plainText
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function getSafePdfUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    const isCloudinaryHost =
      url.hostname === 'res.cloudinary.com' || url.hostname.endsWith('.cloudinary.com');

    if (url.protocol !== 'https:' || !isCloudinaryHost) return '';
    return url.toString();
  } catch {
    return '';
  }
}

onAuthStateChanged(auth, user => {
  isAdmin = !!user;
  document.getElementById('btnNewPost').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('btnLogout').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('btnLoginNav').style.display = isAdmin ? 'none' : 'inline-block';
  renderRecent();
  if (browseType && (browseArea || browseType === 'artigo')) renderBrowse();
});

onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc')), snap => {
  allPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  document.getElementById('statResumos').textContent = allPosts.filter(p => p.type === 'resumo').length;
  document.getElementById('statArtigos').textContent = allPosts.filter(p => p.type === 'artigo').length;
  document.getElementById('statOAB').textContent = allPosts.filter(p => p.type === 'oab').length;
  renderRecent();
  if (browseType && (browseArea || browseType === 'artigo')) renderBrowse();
});

function renderRecent() {
  renderGrid(document.getElementById('postsGrid'), allPosts);
}

function renderBrowse() {
  const filtered = allPosts.filter(p =>
    p.type === browseType && (browseType === 'artigo' || browseArea === 'Todas' || p.area === browseArea)
  );
  renderGrid(document.getElementById('browseResults'), filtered);
}

function renderGrid(container, posts) {
  if (!posts || posts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <p>Nenhum conteudo por aqui ainda</p>
        <span>${isAdmin ? 'Clique em "+ Novo Post" para publicar!' : 'Novos conteudos em breve.'}</span>
      </div>`;
    return;
  }

  container.innerHTML = posts.map(buildCard).join('');
}

function buildCard(p) {
  const dateStr = p.createdAt
    ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  const safeId = encodeURIComponent(String(p.id ?? ''));
  const safeTitle = escapeHtml(p.title);
  const safeArea = escapeHtml(p.area);
  const safeExcerpt = escapeHtml(p.excerpt || '');
  const safeOabExame = escapeHtml(p.oabExame || '');
  const safeOabFase = escapeHtml(p.oabFase || '');
  const safeType = /^[a-z-]+$/i.test(String(p.type ?? '')) ? p.type : 'resumo';
  const safePdfUrl = getSafePdfUrl(p.pdfUrl);

  const typeLabel = { resumo: 'Resumo', artigo: 'Artigo', oab: 'OAB' }[safeType] || safeType;

  const svgMap = {
    resumo: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#e24d90" stroke-width="1.2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    artigo: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#4c6ef5" stroke-width="1.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    oab: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#e8810a" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`
  };

  const oabMeta = (safeType === 'oab' && safeOabExame) ? ` · ${safeOabExame}` : '';
  const faseMeta = (safeType === 'oab' && safeOabFase) ? ` · ${safeOabFase}` : '';
  const pdfPill = safePdfUrl ? `<span class="pdf-pill">📄 PDF</span>` : '';
  const delBtn = isAdmin ? `<button class="post-delete-btn" onclick="event.stopPropagation();deletePost(decodeURIComponent('${safeId}'))" title="Excluir">🗑️</button>` : '';
  const footerTxt = safePdfUrl ? '📄 Baixar PDF' : 'Ler mais →';

  return `
    <div class="post-card" onclick="openPost(decodeURIComponent('${safeId}'))">
      <div class="post-img type-${safeType}">
        <span class="post-type-badge">${typeLabel}</span>
        <span class="post-area-badge">${safeArea}</span>
        ${pdfPill}${delBtn}
        ${svgMap[safeType] || svgMap.resumo}
      </div>
      <div class="post-body">
        <div class="post-date">${dateStr}${oabMeta}${faseMeta}</div>
        <div class="post-title">${safeTitle}</div>
        <div class="post-excerpt">${safeExcerpt}</div>
        <div class="post-footer"><span>${footerTxt}</span></div>
      </div>
    </div>`;
}

window.openPost = function (id) {
  const p = allPosts.find(x => x.id === id);
  if (!p) return;

  const dateStr = p.createdAt
    ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';

  const typeMeta = {
    resumo: { label: 'Resumo', bg: 'var(--pink-50)', color: 'var(--pink-500)', bd: 'var(--pink-200)' },
    artigo: { label: 'Artigo', bg: '#eef3fd', color: '#3b5bdb', bd: '#c5d3f6' },
    oab: { label: 'Prova OAB', bg: '#fff7ed', color: '#c2621a', bd: '#fcd9a8' }
  }[p.type] || { label: escapeHtml(p.type), bg: 'var(--pink-50)', color: 'var(--pink-500)', bd: 'var(--pink-200)' };

  const oabBar = (p.type === 'oab') ? `
    <div class="oab-badges">
      ${p.oabFase ? `<span class="oab-badge">📋 ${escapeHtml(p.oabFase)}</span>` : ''}
      ${p.oabExame ? `<span class="oab-badge">🗓️ ${escapeHtml(p.oabExame)}</span>` : ''}
    </div>` : '';

  const contentHtml = formatTextAsHtml(p.content);
  const contentBlock = contentHtml ? `<div class="modal-body">${contentHtml}</div>` : '';
  const safePdfUrl = getSafePdfUrl(p.pdfUrl);

  const pdfBlock = safePdfUrl ? `
    <div class="pdf-download-block">
      <div class="pdf-dl-info">
        <div class="pdf-dl-icon">📄</div>
        <div>
          <div class="pdf-dl-name">${escapeHtml(p.pdfName || 'Arquivo PDF')}</div>
          <div class="pdf-dl-label">Clique para baixar o arquivo completo</div>
        </div>
      </div>
      <a class="btn-pdf" href="${safePdfUrl}" target="_blank" rel="noopener noreferrer">⬇ Baixar PDF</a>
    </div>` : '';

  document.getElementById('modalBody').innerHTML = `
    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.75rem">
      <span style="background:${typeMeta.bg};color:${typeMeta.color};border:1px solid ${typeMeta.bd};border-radius:100px;padding:.2rem .85rem;font-size:.73rem;font-weight:600">${typeMeta.label}</span>
      <span style="background:var(--pink-50);color:var(--gray-400);border:1px solid var(--pink-100);border-radius:100px;padding:.2rem .85rem;font-size:.73rem">${escapeHtml(p.area)}</span>
    </div>
    ${oabBar}
    <h2>${escapeHtml(p.title)}</h2>
    <div class="modal-meta"><span>📅 ${dateStr}</span></div>
    ${contentBlock}
    ${pdfBlock}`;

  document.getElementById('postModal').classList.add('open');
};
window.closePostModal = () => document.getElementById('postModal').classList.remove('open');

window.selectType = function (type) {
  browseType = type;
  browseArea = type === 'artigo' ? 'Todas' : null;

  ['resumo', 'artigo', 'oab'].forEach(t => {
    document.getElementById(`tab-${t}`).className = 'type-tab' + (t === type ? ` sel-${t}` : '');
  });

  const areaPanel = document.getElementById('areaPanel');
  const areaGrid = document.getElementById('areasGrid');

  areaPanel.classList.add('visible');
  document.querySelectorAll('.area-chip').forEach(c => c.className = 'area-chip');

  if (type === 'artigo') {
    areaGrid.style.display = 'none';
    document.getElementById('areaPanelTitle').textContent = 'Artigos - exibindo todos';
    renderBrowse();
    document.getElementById('browseResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  areaGrid.style.display = 'flex';
  document.getElementById('browseResults').innerHTML = '';

  const labels = { resumo: 'Escolha a area - Resumos', oab: 'Escolha a area - Provas OAB' };
  document.getElementById('areaPanelTitle').textContent = labels[type] || 'Escolha a area';
};

window.selectArea = function (area) {
  browseArea = area;
  const selClass = { resumo: 'sel-resumo', artigo: 'sel-artigo', oab: 'sel-oab' }[browseType] || 'sel-resumo';
  document.querySelectorAll('.area-chip').forEach(c => {
    c.className = 'area-chip' + (c.dataset.area === area ? ` ${selClass}` : '');
  });
  renderBrowse();
  document.getElementById('browseResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.resetFilter = function () {
  document.getElementById('btnVerTodos').style.display = 'none';
  renderRecent();
};

window.openNewPost = function () {
  if (!isAdmin) { openLoginModal(); return; }
  ['newTitle', 'newContent', 'newPdfDesc', 'newOabExame'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pdfSelectedName').textContent = '';
  document.getElementById('pdfFileInput').value = '';
  selectedPdfFile = null;
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadProgressBar').style.width = '0%';
  setFormType('resumo');
  setContentMode('texto');
  document.getElementById('newPostModal').classList.add('open');
};
window.closeNewPostModal = () => document.getElementById('newPostModal').classList.remove('open');

window.setFormType = function (type) {
  formType = type;
  ['resumo', 'artigo', 'oab'].forEach(t => {
    document.getElementById(`ftype-${t}`).className = 'form-type-btn' + (t === type ? ` sel-${t}` : '');
  });
  document.getElementById('oabFields').className = 'oab-fields' + (type === 'oab' ? ' visible' : '');
  document.getElementById('newAreaGroup').style.display = type === 'artigo' ? 'none' : 'block';
  const labels = { resumo: 'Publicar Resumo', artigo: 'Publicar Artigo', oab: 'Publicar Prova OAB' };
  document.getElementById('btnPublish').textContent = labels[type];
};

window.setContentMode = function (mode) {
  contentMode = mode;
  document.getElementById('modeBtnTexto').className = 'content-mode-btn' + (mode === 'texto' ? ' active' : '');
  document.getElementById('modeBtnPDF').className = 'content-mode-btn' + (mode === 'pdf' ? ' active' : '');
  document.getElementById('modeTexto').style.display = mode === 'texto' ? 'block' : 'none';
  document.getElementById('modePDF').style.display = mode === 'pdf' ? 'block' : 'none';
};

window.onPdfSelected = function (e) {
  const file = e.target.files[0];
  if (!file) return;

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    alert('Selecione um arquivo PDF valido.');
    e.target.value = '';
    selectedPdfFile = null;
    document.getElementById('pdfSelectedName').textContent = '';
    return;
  }

  selectedPdfFile = file;
  document.getElementById('pdfSelectedName').textContent = '📄 ' + file.name;
};

window.publishPost = async function () {
  if (!isAdmin) return;
  const title = document.getElementById('newTitle').value.trim();
  const area = formType === 'artigo' ? 'Geral' : document.getElementById('newArea').value;
  const btn = document.getElementById('btnPublish');
  if (!title) { alert('Preencha o titulo!'); return; }

  btn.textContent = 'Publicando...';
  btn.disabled = true;

  try {
    let pdfUrl = null;
    let pdfName = null;

    if (contentMode === 'pdf') {
      if (!selectedPdfFile) {
        alert('Selecione um arquivo PDF!');
        btn.textContent = 'Publicar';
        btn.disabled = false;
        return;
      }

      const prog = document.getElementById('uploadProgress');
      const bar = document.getElementById('uploadProgressBar');
      prog.style.display = 'block';

      pdfUrl = await new Promise((res, rej) => {
        const formData = new FormData();
        formData.append('file', selectedPdfFile);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`);

        xhr.upload.onprogress = e => {
          if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%';
        };
        xhr.onload = () => {
          if (xhr.status === 200) {
            res(JSON.parse(xhr.responseText).secure_url);
          } else {
            rej(new Error('Falha no upload: ' + xhr.responseText));
          }
        };
        xhr.onerror = () => rej(new Error('Erro de rede ao enviar PDF.'));
        xhr.send(formData);
      });

      pdfName = selectedPdfFile.name;
      prog.style.display = 'none';
    }

    const rawText = contentMode === 'texto'
      ? document.getElementById('newContent').value.trim()
      : document.getElementById('newPdfDesc').value.trim();

    const excerpt = rawText.substring(0, 160) + (rawText.length > 160 ? '...' : '');

    const data = { type: formType, title, area, excerpt, content: rawText, createdAt: serverTimestamp() };
    if (pdfUrl) data.pdfUrl = pdfUrl;
    if (pdfName) data.pdfName = pdfName;
    if (formType === 'oab') {
      data.oabFase = document.getElementById('newOabFase').value;
      data.oabExame = document.getElementById('newOabExame').value.trim();
    }

    await addDoc(collection(db, 'posts'), data);
    closeNewPostModal();
    document.getElementById('posts').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    alert('Erro ao publicar: ' + e.message);
  }

  btn.textContent = { resumo: 'Publicar Resumo', artigo: 'Publicar Artigo', oab: 'Publicar Prova OAB' }[formType];
  btn.disabled = false;
};

window.deletePost = async function (id) {
  if (!isAdmin || !confirm('Excluir este conteudo?')) return;
  await deleteDoc(doc(db, 'posts', id));
};

window.openLoginModal = function () {
  document.getElementById('loginModal').classList.add('open');
  setTimeout(() => document.getElementById('loginEmail').focus(), 200);
};
window.closeLoginModal = function () {
  document.getElementById('loginModal').classList.remove('open');
  document.getElementById('loginError').classList.remove('show');
};
window.doLogin = async function () {
  const email = document.getElementById('loginEmail').value.trim();
  const pwd = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  const btn = document.getElementById('btnLoginSubmit');
  err.classList.remove('show');
  btn.textContent = 'Entrando...';
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pwd);
    closeLoginModal();
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
  } catch {
    err.textContent = 'E-mail ou senha incorretos.';
    err.classList.add('show');
  }
  btn.textContent = 'Entrar';
  btn.disabled = false;
};
window.logout = () => signOut(auth);

setFormType('resumo');
