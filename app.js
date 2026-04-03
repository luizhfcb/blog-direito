import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, deleteDoc, doc, query, orderBy, onSnapshot, serverTimestamp, updateDoc }
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
let searchQuery = '';

let formType = 'resumo';
let contentMode = 'texto';
let selectedPdfFile = null;

let editingPostId = null;
let editSelectedPdfFile = null;

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

function normalizeForSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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

function isSearchActive() {
  return searchQuery.trim().length > 0;
}

function getSearchResults() {
  const normalizedQuery = normalizeForSearch(searchQuery);
  if (!normalizedQuery) return [];

  return allPosts.filter(post => normalizeForSearch(post.title).includes(normalizedQuery));
}

function getExcerpt(rawText) {
  return rawText.substring(0, 160) + (rawText.length > 160 ? '...' : '');
}

function validatePdfFile(file) {
  return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
}

async function uploadPdfFile(file, progressId, progressBarId) {
  const progress = document.getElementById(progressId);
  const progressBar = document.getElementById(progressBarId);

  progress.style.display = 'block';
  progressBar.style.width = '0%';

  try {
    return await new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`);

      xhr.upload.onprogress = event => {
        if (event.lengthComputable) {
          progressBar.style.width = `${(event.loaded / event.total) * 100}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText).secure_url);
          return;
        }

        reject(new Error(`Falha no upload: ${xhr.responseText}`));
      };

      xhr.onerror = () => reject(new Error('Erro de rede ao enviar PDF.'));
      xhr.send(formData);
    });
  } finally {
    progress.style.display = 'none';
    progressBar.style.width = '0%';
  }
}

function renderGrid(container, posts, emptyState = null) {
  if (!posts || posts.length === 0) {
    const state = emptyState || {
      icon: '📚',
      title: 'Nenhum conteúdo por aqui ainda',
      description: isAdmin ? 'Clique em "+ Novo Post" para publicar!' : 'Novos conteúdos em breve.'
    };

    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${state.icon}</div>
        <p>${state.title}</p>
        <span>${state.description}</span>
      </div>`;
    return;
  }

  container.innerHTML = posts.map(buildCard).join('');
}

function renderRecent() {
  const title = document.getElementById('recentSectionTitle');
  const status = document.getElementById('searchStatus');
  const clearButton = document.getElementById('btnClearSearch');
  const searchInput = document.getElementById('searchInput');

  if (searchInput && searchInput.value !== searchQuery) {
    searchInput.value = searchQuery;
  }

  if (isSearchActive()) {
    const results = getSearchResults();
    title.innerHTML = 'Resultados <em>da busca</em>';
    status.textContent = `${results.length} resultado${results.length === 1 ? '' : 's'} para "${searchQuery}"`;
    clearButton.style.display = 'inline-flex';

    renderGrid(document.getElementById('postsGrid'), results, {
      icon: '🔎',
      title: 'Nenhum conteúdo encontrado',
      description: 'Tente buscar por outro título.'
    });
    return;
  }

  title.innerHTML = 'Conteúdos <em>recentes</em>';
  status.textContent = 'Busque por qualquer conteúdo publicado no site.';
  clearButton.style.display = 'none';
  renderGrid(document.getElementById('postsGrid'), allPosts.slice(0, 3));
}

function renderBrowse() {
  const browseHelper = document.getElementById('browseHelper');
  const browseResults = document.getElementById('browseResults');
  const areaPanel = document.getElementById('areaPanel');

  if (isSearchActive()) {
    browseHelper.textContent = 'A busca global está mostrando os resultados acima. Limpe a busca para explorar por categoria.';
    browseResults.innerHTML = '';
    areaPanel.classList.remove('visible');
    return;
  }

  browseHelper.textContent = '';

  if (!browseType || (!browseArea && browseType !== 'artigo')) {
    browseResults.innerHTML = '';
    return;
  }

  const filtered = allPosts.filter(post =>
    post.type === browseType && (browseType === 'artigo' || browseArea === 'Todas' || post.area === browseArea)
  );
  renderGrid(browseResults, filtered);
}

function buildCard(post) {
  const dateStr = post.createdAt
    ? new Date(post.createdAt.seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  const safeId = encodeURIComponent(String(post.id ?? ''));
  const safeTitle = escapeHtml(post.title);
  const safeArea = escapeHtml(post.area);
  const safeExcerpt = escapeHtml(post.excerpt || '');
  const safeOabExame = escapeHtml(post.oabExame || '');
  const safeOabFase = escapeHtml(post.oabFase || '');
  const safeType = /^[a-z-]+$/i.test(String(post.type ?? '')) ? post.type : 'resumo';
  const safePdfUrl = getSafePdfUrl(post.pdfUrl);

  const typeLabel = { resumo: 'Resumo', artigo: 'Artigo', oab: 'OAB' }[safeType] || safeType;

  const svgMap = {
    resumo: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#e24d90" stroke-width="1.2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
    artigo: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#4c6ef5" stroke-width="1.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    oab: `<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#e8810a" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`
  };

  const oabMeta = (safeType === 'oab' && safeOabExame) ? ` · ${safeOabExame}` : '';
  const faseMeta = (safeType === 'oab' && safeOabFase) ? ` · ${safeOabFase}` : '';
  const pdfPill = safePdfUrl ? `<span class="pdf-pill">📄 PDF</span>` : '';
  const adminActions = isAdmin ? `
    <div class="post-admin-actions">
      <button class="post-edit-btn" onclick="event.stopPropagation();openEditPost(decodeURIComponent('${safeId}'))" title="Editar">Editar</button>
      <button class="post-delete-btn" onclick="event.stopPropagation();deletePost(decodeURIComponent('${safeId}'))" title="Excluir">🗑</button>
    </div>` : '';
  const footerTxt = safePdfUrl ? '📄 Baixar PDF' : 'Ler mais →';

  return `
    <div class="post-card" onclick="openPost(decodeURIComponent('${safeId}'))">
      <div class="post-img type-${safeType}">
        <span class="post-type-badge">${typeLabel}</span>
        <span class="post-area-badge">${safeArea}</span>
        ${pdfPill}
        ${adminActions}
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

function configureEditModal(post) {
  const safePdfUrl = getSafePdfUrl(post.pdfUrl);
  const typeLabel = { resumo: 'Resumo', artigo: 'Artigo', oab: 'Prova OAB' }[post.type] || 'Conteúdo';

  document.getElementById('editTypeLabel').textContent = typeLabel;
  document.getElementById('editTitle').value = post.title || '';
  document.getElementById('editContent').value = normalizeStoredText(post.content);
  document.getElementById('editPdfSelectedName').textContent = '';
  document.getElementById('editPdfFileInput').value = '';
  document.getElementById('editUploadProgress').style.display = 'none';
  document.getElementById('editUploadProgressBar').style.width = '0%';

  const areaGroup = document.getElementById('editAreaGroup');
  if (post.type === 'artigo') {
    areaGroup.style.display = 'none';
  } else {
    areaGroup.style.display = 'block';
    document.getElementById('editArea').value = post.area || 'Civil';
  }

  const oabFields = document.getElementById('editOabFields');
  if (post.type === 'oab') {
    oabFields.classList.add('visible');
    document.getElementById('editOabFase').value = post.oabFase || '1ª Fase';
    document.getElementById('editOabExame').value = post.oabExame || '';
  } else {
    oabFields.classList.remove('visible');
    document.getElementById('editOabFase').value = '1ª Fase';
    document.getElementById('editOabExame').value = '';
  }

  const currentFileBlock = document.getElementById('editCurrentFileBlock');
  const currentFileName = document.getElementById('editCurrentFileName');
  const currentFileLink = document.getElementById('editCurrentFileLink');

  if (safePdfUrl) {
    currentFileBlock.style.display = 'flex';
    currentFileName.textContent = post.pdfName || 'Arquivo PDF atual';
    currentFileLink.href = safePdfUrl;
  } else {
    currentFileBlock.style.display = 'none';
    currentFileName.textContent = '';
    currentFileLink.removeAttribute('href');
  }
}

onAuthStateChanged(auth, user => {
  isAdmin = !!user;
  document.getElementById('btnNewPost').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('btnLogout').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('btnLoginNav').style.display = isAdmin ? 'none' : 'inline-block';
  renderRecent();
  renderBrowse();
});

onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc')), snap => {
  allPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  document.getElementById('statResumos').textContent = allPosts.filter(post => post.type === 'resumo').length;
  document.getElementById('statArtigos').textContent = allPosts.filter(post => post.type === 'artigo').length;
  document.getElementById('statOAB').textContent = allPosts.filter(post => post.type === 'oab').length;
  renderRecent();
  renderBrowse();
});

window.openPost = function (id) {
  const post = allPosts.find(item => item.id === id);
  if (!post) return;

  const dateStr = post.createdAt
    ? new Date(post.createdAt.seconds * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';

  const typeMeta = {
    resumo: { label: 'Resumo', bg: 'var(--pink-50)', color: 'var(--pink-500)', bd: 'var(--pink-200)' },
    artigo: { label: 'Artigo', bg: '#eef3fd', color: '#3b5bdb', bd: '#c5d3f6' },
    oab: { label: 'Prova OAB', bg: '#fff7ed', color: '#c2621a', bd: '#fcd9a8' }
  }[post.type] || { label: escapeHtml(post.type), bg: 'var(--pink-50)', color: 'var(--pink-500)', bd: 'var(--pink-200)' };

  const oabBar = (post.type === 'oab') ? `
    <div class="oab-badges">
      ${post.oabFase ? `<span class="oab-badge">📋 ${escapeHtml(post.oabFase)}</span>` : ''}
      ${post.oabExame ? `<span class="oab-badge">🗓️ ${escapeHtml(post.oabExame)}</span>` : ''}
    </div>` : '';

  const contentHtml = formatTextAsHtml(post.content);
  const contentBlock = contentHtml ? `<div class="modal-body">${contentHtml}</div>` : '';
  const safePdfUrl = getSafePdfUrl(post.pdfUrl);

  const pdfBlock = safePdfUrl ? `
    <div class="pdf-download-block">
      <div class="pdf-dl-info">
        <div class="pdf-dl-icon">📄</div>
        <div>
          <div class="pdf-dl-name">${escapeHtml(post.pdfName || 'Arquivo PDF')}</div>
          <div class="pdf-dl-label">Clique para baixar o arquivo completo</div>
        </div>
      </div>
      <a class="btn-pdf" href="${safePdfUrl}" target="_blank" rel="noopener noreferrer">⬇ Baixar PDF</a>
    </div>` : '';

  document.getElementById('modalBody').innerHTML = `
    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.75rem">
      <span style="background:${typeMeta.bg};color:${typeMeta.color};border:1px solid ${typeMeta.bd};border-radius:100px;padding:.2rem .85rem;font-size:.73rem;font-weight:600">${typeMeta.label}</span>
      <span style="background:var(--pink-50);color:var(--gray-400);border:1px solid var(--pink-100);border-radius:100px;padding:.2rem .85rem;font-size:.73rem">${escapeHtml(post.area)}</span>
    </div>
    ${oabBar}
    <h2>${escapeHtml(post.title)}</h2>
    <div class="modal-meta"><span>📅 ${dateStr}</span></div>
    ${contentBlock}
    ${pdfBlock}`;

  document.getElementById('postModal').classList.add('open');
};

window.closePostModal = () => document.getElementById('postModal').classList.remove('open');

window.selectType = function (type) {
  browseType = type;
  browseArea = type === 'artigo' ? 'Todas' : null;

  ['resumo', 'artigo', 'oab'].forEach(item => {
    document.getElementById(`tab-${item}`).className = 'type-tab' + (item === type ? ` sel-${item}` : '');
  });

  document.getElementById('areaPanel').classList.add('visible');
  document.querySelectorAll('.area-chip').forEach(chip => chip.className = 'area-chip');

  if (type === 'artigo') {
    document.getElementById('areasGrid').style.display = 'none';
    document.getElementById('areaPanelTitle').textContent = 'Artigos - exibindo todos';
    renderBrowse();
    document.getElementById('browseResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  document.getElementById('areasGrid').style.display = 'flex';
  document.getElementById('browseResults').innerHTML = '';

  const labels = { resumo: 'Escolha a área - Resumos', oab: 'Escolha a área - Provas OAB' };
  document.getElementById('areaPanelTitle').textContent = labels[type] || 'Escolha a área';
};

window.selectArea = function (area) {
  browseArea = area;
  const selectedClass = { resumo: 'sel-resumo', artigo: 'sel-artigo', oab: 'sel-oab' }[browseType] || 'sel-resumo';

  document.querySelectorAll('.area-chip').forEach(chip => {
    chip.className = 'area-chip' + (chip.dataset.area === area ? ` ${selectedClass}` : '');
  });

  renderBrowse();
  document.getElementById('browseResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.resetFilter = function () {
  document.getElementById('btnVerTodos').style.display = 'none';
  browseType = null;
  browseArea = null;
  document.getElementById('browseResults').innerHTML = '';
  document.getElementById('areaPanel').classList.remove('visible');
  renderRecent();
};

window.setSearchQuery = function (value) {
  searchQuery = value.trim();
  renderRecent();
  renderBrowse();
};

window.clearSearch = function () {
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  renderRecent();
  renderBrowse();
};

window.openNewPost = function () {
  if (!isAdmin) {
    openLoginModal();
    return;
  }

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
  ['resumo', 'artigo', 'oab'].forEach(item => {
    document.getElementById(`ftype-${item}`).className = 'form-type-btn' + (item === type ? ` sel-${item}` : '');
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

window.onPdfSelected = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!validatePdfFile(file)) {
    alert('Selecione um arquivo PDF válido.');
    event.target.value = '';
    selectedPdfFile = null;
    document.getElementById('pdfSelectedName').textContent = '';
    return;
  }

  selectedPdfFile = file;
  document.getElementById('pdfSelectedName').textContent = `📄 ${file.name}`;
};

window.publishPost = async function () {
  if (!isAdmin) return;

  const title = document.getElementById('newTitle').value.trim();
  const area = formType === 'artigo' ? 'Geral' : document.getElementById('newArea').value;
  const btn = document.getElementById('btnPublish');

  if (!title) {
    alert('Preencha o título!');
    return;
  }

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

      pdfUrl = await uploadPdfFile(selectedPdfFile, 'uploadProgress', 'uploadProgressBar');
      pdfName = selectedPdfFile.name;
    }

    const rawText = contentMode === 'texto'
      ? document.getElementById('newContent').value.trim()
      : document.getElementById('newPdfDesc').value.trim();

    const data = {
      type: formType,
      title,
      area,
      excerpt: getExcerpt(rawText),
      content: rawText,
      createdAt: serverTimestamp()
    };

    if (pdfUrl) data.pdfUrl = pdfUrl;
    if (pdfName) data.pdfName = pdfName;
    if (formType === 'oab') {
      data.oabFase = document.getElementById('newOabFase').value;
      data.oabExame = document.getElementById('newOabExame').value.trim();
    }

    await addDoc(collection(db, 'posts'), data);
    closeNewPostModal();
    document.getElementById('posts').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    alert(`Erro ao publicar: ${error.message}`);
  }

  btn.textContent = { resumo: 'Publicar Resumo', artigo: 'Publicar Artigo', oab: 'Publicar Prova OAB' }[formType];
  btn.disabled = false;
};

window.openEditPost = function (id) {
  if (!isAdmin) return;

  const post = allPosts.find(item => item.id === id);
  if (!post) return;

  editingPostId = id;
  editSelectedPdfFile = null;
  configureEditModal(post);
  document.getElementById('editPostModal').classList.add('open');
};

window.closeEditPostModal = function () {
  editingPostId = null;
  editSelectedPdfFile = null;
  document.getElementById('editPostModal').classList.remove('open');
};

window.onEditPdfSelected = function (event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!validatePdfFile(file)) {
    alert('Selecione um arquivo PDF válido.');
    event.target.value = '';
    editSelectedPdfFile = null;
    document.getElementById('editPdfSelectedName').textContent = '';
    return;
  }

  editSelectedPdfFile = file;
  document.getElementById('editPdfSelectedName').textContent = `📄 Novo arquivo: ${file.name}`;
};

window.savePostChanges = async function () {
  if (!isAdmin || !editingPostId) return;

  const post = allPosts.find(item => item.id === editingPostId);
  if (!post) return;

  const title = document.getElementById('editTitle').value.trim();
  const rawText = document.getElementById('editContent').value.trim();
  const btn = document.getElementById('btnSaveEdit');

  if (!title) {
    alert('Preencha o título!');
    return;
  }

  btn.textContent = 'Salvando...';
  btn.disabled = true;

  try {
    let pdfUrl = post.pdfUrl || null;
    let pdfName = post.pdfName || null;

    if (editSelectedPdfFile) {
      pdfUrl = await uploadPdfFile(editSelectedPdfFile, 'editUploadProgress', 'editUploadProgressBar');
      pdfName = editSelectedPdfFile.name;
    }

    const updates = {
      title,
      area: post.type === 'artigo' ? 'Geral' : document.getElementById('editArea').value,
      excerpt: getExcerpt(rawText),
      content: rawText
    };

    if (pdfUrl) updates.pdfUrl = pdfUrl;
    if (pdfName) updates.pdfName = pdfName;
    if (post.type === 'oab') {
      updates.oabFase = document.getElementById('editOabFase').value;
      updates.oabExame = document.getElementById('editOabExame').value.trim();
    }

    await updateDoc(doc(db, 'posts', editingPostId), updates);
    closeEditPostModal();
  } catch (error) {
    alert(`Erro ao salvar alterações: ${error.message}`);
  }

  btn.textContent = 'Salvar alterações';
  btn.disabled = false;
};

window.deletePost = async function (id) {
  if (!isAdmin || !confirm('Excluir este conteúdo?')) return;
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
renderRecent();
