// --- DATA MANAGEMENT & HELPERS ---
const STORAGE_KEY = 'youtubeSoundboardData';
let soundData = [];
let currentlyEditingIndex = null;
let draggedIndex = null;
let pendingImportData = null;
let activePlayers = {}; // { [index]: player }

function extractYouTubeId(url) {
    if (!url) return '';
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : url.trim();
}

function migrateData(data) {
    if (data.length > 0 && typeof data[0].type === 'undefined') {
        return data.map(clip => ({ 
            type: 'clip', 
            ...clip, 
            loop: clip.loop || false // Add loop property during migration
        }));
    }
    return data;
}

function saveLayout() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(soundData));
}

function loadLayout() {
  let savedData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (savedData.length === 0) {
      savedData = [
          { type: 'clip', name: "Leeroy Jenkins", videoId: 'M5QY2_8704o', startTime: 7, endTime: 9, loop: false },
          { type: 'divider', name: 'Meme Sounds' },
          { type: 'clip', name: "It's a Trap!", videoId: '4F4qzPbcFiA', startTime: 25, endTime: 26, loop: false },
          { type: 'clip', name: "Looping Lofi", videoId: '5qap5aO4i9A', startTime: 0, endTime: 0, loop: true },
      ];
  }
  soundData = migrateData(savedData);
}

// --- INITIALIZATION ---
loadLayout();

var tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// --- PLAYER LOGIC ---
function onYouTubeIframeAPIReady() {
    console.log("YouTube API is ready to create players on demand.");
    renderLayout();
    setupEventListeners();
}

// --- UI RENDERING & EVENT HANDLING ---

function renderLayout() {
  const grid = document.getElementById('sound-grid');
  grid.innerHTML = '';
  soundData.forEach((item, index) => {
    let element;
    if (item.type === 'clip') {
        element = document.createElement('button');
        element.innerText = item.name;
        if (!item.videoId || item.videoId.trim() === '') {
            element.disabled = true;
        }
        if (activePlayers[index]) {
            element.classList.add('playing');
        }
        if(item.loop) {
            const badge = document.createElement('span');
            badge.className = 'loop-badge';
            badge.innerHTML = '🔁';
            badge.title = 'Toggle loop';
            element.appendChild(badge);
        }
    } else if (item.type === 'divider') {
        element = document.createElement('div');
        element.className = 'divider-row';
        element.innerHTML = `
            <span class="divider-name">${item.name}</span>
            <button class="delete-divider-btn" title="Delete divider">&times;</button>
        `;
    }
    element.draggable = true;
    element.dataset.index = index;
    grid.appendChild(element);
  });
}

function setupEventListeners() {
  const grid = document.getElementById('sound-grid');
  grid.addEventListener('click', handleGridClick);
  grid.addEventListener('contextmenu', handleGridRightClick);
  grid.addEventListener('dragstart', handleDragStart);
  grid.addEventListener('dragover', handleDragOver);
  grid.addEventListener('drop', handleDrop);
  grid.addEventListener('dragend', handleDragEnd);

  document.getElementById('add-clip-btn').addEventListener('click', handleAddClick);
  document.getElementById('add-divider-btn').addEventListener('click', handleAddDividerClick);
  document.getElementById('export-btn').addEventListener('click', handleExport);
  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', handleFileSelect);
  
  document.getElementById('edit-form').addEventListener('submit', handleSave);
  document.querySelector('#edit-modal .cancel-btn').addEventListener('click', () => hideModal('edit-modal'));
  document.querySelector('#edit-modal .delete-btn').addEventListener('click', handleDeleteClip);

  document.getElementById('import-append-btn').addEventListener('click', handleImportAppend);
  document.getElementById('import-overwrite-btn').addEventListener('click', handleImportOverwrite);
  document.getElementById('import-cancel-btn').addEventListener('click', () => hideModal('import-options-modal'));
}

function handleGridClick(event) {
    const target = event.target;

    if (target.classList.contains('loop-badge')) {
        event.stopPropagation();
        const button = target.closest('button');
        const index = parseInt(button.dataset.index);
        soundData[index].loop = !soundData[index].loop;
        saveLayout();
        renderLayout();
        return;
    }

    if (target.classList.contains('delete-divider-btn')) {
        const dividerEl = target.closest('.divider-row');
        const index = parseInt(dividerEl.dataset.index);
        if (confirm(`Delete the "${soundData[index].name}" divider?`)) {
            soundData.splice(index, 1);
            saveLayout();
            renderLayout();
        }
    } 
    else if (target.tagName === 'BUTTON' && !target.disabled && !target.id) {
        const index = target.dataset.index;
        if (activePlayers[index]) {
            activePlayers[index].customDestroy();
        } 
        else {
            playClip(target);
        }
    }
}

function playClip(buttonElement) {
    const index = buttonElement.dataset.index;
    const clip = soundData[index];
    const { videoId, startTime, endTime, loop } = clip;

    const playerContainer = document.getElementById('player-container');
    const newPlayerDiv = document.createElement('div');
    newPlayerDiv.id = `player-${Date.now()}`;
    playerContainer.appendChild(newPlayerDiv);

    let stopTimeout;
    buttonElement.classList.add('playing');

    const destroyPlayer = () => {
        clearTimeout(stopTimeout);
        if (tempPlayer && typeof tempPlayer.destroy === 'function') {
            tempPlayer.destroy();
        }
        if (newPlayerDiv && newPlayerDiv.parentNode) {
            newPlayerDiv.parentNode.removeChild(newPlayerDiv);
        }
        delete activePlayers[index];
        
        const btn = document.querySelector(`.sound-grid button[data-index="${index}"]`);
        if (btn) btn.classList.remove('playing');
    };

    const tempPlayer = new YT.Player(newPlayerDiv.id, {
        height: '0',
        width: '0',
        videoId: videoId,
        playerVars: { 
            'playsinline': 1, 
            'autoplay': 1, 
            'start': startTime || 0, 
            'controls': 0,
        },
        events: { 
            'onStateChange': (event) => {
                if (event.data === YT.PlayerState.ENDED) {
                    if(loop) {
                        tempPlayer.seekTo(startTime || 0, true);
                    } else {
                        destroyPlayer();
                    }
                }
            } 
        }
    });
    
    tempPlayer.customDestroy = destroyPlayer;
    activePlayers[index] = tempPlayer;

    if (endTime > startTime && !loop) {
        const duration = (endTime - startTime) * 1000;
        stopTimeout = setTimeout(destroyPlayer, duration);
    }
}

function handleGridRightClick(event) {
  const buttonTarget = event.target.closest('button');
  const dividerTarget = event.target.closest('.divider-row');

  if (dividerTarget) {
    event.preventDefault();
    const index = parseInt(dividerTarget.dataset.index);
    const oldName = soundData[index].name;
    const newName = prompt("Enter new name for the divider:", oldName);

    if (newName && newName.trim() !== oldName) {
      soundData[index].name = newName.trim();
      saveLayout();
      renderLayout();
    }
  } 
  else if (buttonTarget && !buttonTarget.classList.contains('delete-divider-btn') && !buttonTarget.id) {
    event.preventDefault();
    const index = buttonTarget.dataset.index;
    currentlyEditingIndex = parseInt(index);
    const clip = soundData[index];
    document.getElementById('modal-title').innerText = "Edit Sound Clip";
    document.getElementById('edit-form').reset();
    document.getElementById('clip-name').value = clip.name;
    document.getElementById('clip-videoid').value = clip.videoId;
    document.getElementById('clip-starttime').value = clip.startTime;
    document.getElementById('clip-endtime').value = clip.endTime;
    document.getElementById('clip-loop').checked = clip.loop || false;
    document.querySelector('#edit-modal .delete-btn').classList.remove('hidden');
    showModal('edit-modal');
  }
}

function handleAddClick() {
  currentlyEditingIndex = 'new-clip';
  document.getElementById('modal-title').innerText = "Add New Sound Clip";
  document.getElementById('edit-form').reset();
  document.querySelector('#edit-modal .delete-btn').classList.add('hidden');
  showModal('edit-modal');
}

function handleAddDividerClick() {
    const name = prompt("Enter a name for the new section divider:", "New Section");
    if (name) {
        soundData.push({ type: 'divider', name: name });
        saveLayout();
        renderLayout();
    }
}

// --- Import / Export ---

/**
 * UPDATED: Now prompts the user for a filename before exporting.
 */
function handleExport() {
    // 1. Prompt the user for a filename
    const defaultName = `soundboard-layout-${Date.now()}.json`;
    let filename = prompt("Enter a filename for your export:", defaultName);

    // 2. If the user cancels or provides no name, abort the export.
    if (!filename || filename.trim() === '') {
        return; 
    }

    // 3. Ensure the filename ends with .json
    if (!filename.endsWith('.json')) {
        filename += '.json';
    }

    // 4. Proceed with the export using the user-provided filename
    const dataStr = JSON.stringify(soundData, null, 2);
    const dataBlob = new Blob([dataStr], {type: "application/json"});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename; // Use the desired filename
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if (!Array.isArray(importedData) || (importedData.length > 0 && typeof importedData[0].type === 'undefined')) {
                throw new Error("Invalid or old format file.");
            }
            pendingImportData = migrateData(importedData);
            showModal('import-options-modal');

        } catch (error) {
            alert("Error: Could not import file. Please make sure it is a valid soundboard layout JSON file.\n" + error.message);
        } finally {
            event.target.value = null;
        }
    };
    reader.readAsText(file);
}

function handleImportAppend() {
    if (!pendingImportData) return;
    soundData.push(...pendingImportData);
    saveLayout();
    renderLayout();
    hideModal('import-options-modal');
    pendingImportData = null;
}

function handleImportOverwrite() {
    if (!pendingImportData) return;
    soundData = pendingImportData;
    saveLayout();
    renderLayout();
    hideModal('import-options-modal');
    pendingImportData = null;
}

// --- Drag and Drop Handlers ---
function handleDragStart(e) {
  draggedIndex = parseInt(e.target.dataset.index);
  setTimeout(() => e.target.classList.add('dragging'), 0);
}
function handleDragOver(e) { e.preventDefault(); }
function handleDrop(e) {
  e.preventDefault();
  const dropTarget = e.target.closest('[draggable="true"]');
  if (dropTarget) {
    const dropIndex = parseInt(dropTarget.dataset.index);
    if (draggedIndex === dropIndex) return;
    const [reorderedItem] = soundData.splice(draggedIndex, 1);
    soundData.splice(dropIndex, 0, reorderedItem);
    saveLayout();
    renderLayout();
  }
}
function handleDragEnd(e) {
    const draggingElement = document.querySelector('.dragging');
    if(draggingElement) draggingElement.classList.remove('dragging');
}

// --- MODAL & DATA FUNCTIONS ---
function showModal(modalId) { document.getElementById(modalId).classList.remove('hidden'); }
function hideModal(modalId) { document.getElementById(modalId).classList.add('hidden'); }

function handleDeleteClip() {
  if (typeof currentlyEditingIndex !== 'number') return;
  const clipName = soundData[currentlyEditingIndex].name;
  if (confirm(`Are you sure you want to delete "${clipName}"?`)) {
    soundData.splice(currentlyEditingIndex, 1);
    saveLayout();
    renderLayout();
    hideModal('edit-modal');
  }
}

function handleSave(event) {
  event.preventDefault();
  const rawVideoIdInput = document.getElementById('clip-videoid').value;
  const newClipData = {
    type: 'clip',
    name: document.getElementById('clip-name').value,
    videoId: extractYouTubeId(rawVideoIdInput),
    startTime: parseFloat(document.getElementById('clip-starttime').value) || 0,
    endTime: parseFloat(document.getElementById('clip-endtime').value) || 0,
    loop: document.getElementById('clip-loop').checked,
  };
  if (currentlyEditingIndex === 'new-clip') {
    soundData.push(newClipData);
  } else if (typeof currentlyEditingIndex === 'number') {
    soundData[currentlyEditingIndex] = newClipData;
  }
  saveLayout();
  renderLayout();
  hideModal('edit-modal');
}