// public/auditor.js (FILE MỚI)

// === BIẾN TOÀN CỤC (CHO TRANG NÀY) ===

let userEmail = '';
let technicianName = '';
let technicianMap = new Map();
let techniciansLoaded = false;
let auditorHistoryListener = null;
let auditorHistoryCache = [];
const HISTORY_PAGE_SIZE = 15;
let auditorHistoryLastDoc = null;
let isAuditorInitialLoad = true;
let isAudioEnabled = false;
const chimeSound = new Audio('/chime.mp3');


// === HÀM AUTH (ĐƠN GIẢN HÓA) ===

function signInWithGoogle() {
    auth.signInWithPopup(provider).catch((error) => {
        console.error("Lỗi signInWithPopup:", error.message);
    });
}

function attachAuthListener(authButton, signOutButton) {
    auth.onAuthStateChanged(user => {
        if (user) {
            // User đã đăng nhập
            userEmail = user.email;
            technicianName = user.displayName;
            if (authButton) authButton.style.display = 'none';
            if (signOutButton) signOutButton.style.display = 'inline-block';
            document.getElementById('auditorPage').style.display = 'block';
            
            // Tải các tài nguyên cần thiết
            loadTechnicians();
            listenForAuditorHistory();
        } else {
            // User chưa đăng nhập
            if (authButton) authButton.style.display = 'inline-block';
            if (signOutButton) signOutButton.style.display = 'none';
            document.getElementById('auditorPage').style.display = 'none';
            if (auditorHistoryListener) auditorHistoryListener();
        }
    });
}

// === LOGIC CỦA TRANG AUDITOR (COPY TỪ APP.JS) ===

// SỬA LẠI HÀM NÀY ĐỂ GỌI API MỚI
function loadTechnicians(){
    techniciansLoaded = false;
    technicianMap.clear();

    // GỌI API MỚI (PUBLIC)
    callApi('/public/technicians', {}) 
        .then(techs => {
            var selAuditorHistory = document.getElementById('auditorHistoryFilterTech');
            if (selAuditorHistory) selAuditorHistory.innerHTML = '<option value="Tất cả">Tất cả KTV</option>';

            (techs||[]).forEach(function(t){
                if (!t || !t.email) return;
                const name = t.name || t.email;
                const text = t.name ? `${t.name} (${t.email})` : t.email;
                technicianMap.set(t.email, name); 

                var o=document.createElement('option');
                o.value=t.email;
                o.text= text;
                if (selAuditorHistory) selAuditorHistory.appendChild(o.cloneNode(true));
            });
            techniciansLoaded = true;
        })
        .catch(err => {
            console.error('Lỗi tải danh sách KTV: '+err.message);
            techniciansLoaded = false;
        });
}

// COPY CÁC HÀM SAU TỪ APP.JS (GIỮ NGUYÊN)
function formatManagerHistoryContent(doc) {
    let html = '';
    let statusHtml = '';
    let techDisplay = doc.email; 
    if (technicianMap.has(doc.email)) {
        const name = technicianMap.get(doc.email);
        if (name && name.trim() !== '') {
            techDisplay = name;
        }
    } else if (techniciansLoaded) {
         techDisplay = `${doc.email} (cũ)`;
    }
    html += `<strong>KTV:</strong> ${techDisplay}<br>`;
    if (doc.status === 'Pending') {
        statusHtml = `<span style="color: blue; font-style: italic;">(Đang chờ duyệt...)</span><br>`;
    } else if (doc.status === 'Rejected') {
        let reason = doc.rejectionReason ? `: ${doc.rejectionReason}` : '';
        statusHtml = `<span style="color: red; font-style: italic;">(Bị từ chối${reason})</span><br>`;
    }
    let noteDisplay = (doc.status === 'Rejected' && doc.note) ? `<s>${doc.note}</s>` : doc.note;
    if (noteDisplay) {
        html += `<strong>Nội dung:</strong> ${noteDisplay}<br>`;
    }
    html += statusHtml;
    if (doc.items && doc.items.length > 0) {
        html += `<strong>Vật tư đã duyệt:</strong><ul>`;
        doc.items.forEach(item => {
            html += `<li>${item.name || item.code}: ${item.quantity}</li>`;
        });
        html += `</ul>`;
    }
    return html;
}

function formatAuditorHistoryContent(doc) {
    return formatManagerHistoryContent(doc);
}

function renderAuditorHistoryTable() {
    const tbody = document.getElementById('auditorHistoryBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // XÓA BỘ LỌC CŨ (VÌ QUERY ĐÃ LỌC RỒI)

    if (auditorHistoryCache.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Không có dữ liệu khớp với bộ lọc.</td></tr>';
        return;
    }

    auditorHistoryCache.forEach(doc => { // Dùng cache trực tiếp
        const tr = document.createElement('tr');
        const timestamp = new Date(doc.timestamp).toLocaleString('vi-VN');
        const typeClass = doc.type === 'Mượn' ? 'unreconciled' : 'success';
        tr.innerHTML = `
            <td data-label="Thời gian">${timestamp}</td>
            <td data-label="Loại"><strong class="${typeClass}">${doc.type}</strong></td>
            <td data-label="Nội dung">${formatAuditorHistoryContent(doc)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function listenForAuditorHistory() {
    if (auditorHistoryListener) auditorHistoryListener();

    auditorHistoryCache = []; // XÓA CACHE CŨ
    auditorHistoryLastDoc = null; // RESET PHÂN TRANG

    const spinner = document.getElementById('auditorHistorySpinner');
    if (spinner) spinner.style.display = 'block';

    const loadMoreBtn = document.getElementById('loadMoreAuditorHistory');
    if (loadMoreBtn) { loadMoreBtn.style.display = 'none'; loadMoreBtn.disabled = false; loadMoreBtn.innerText = 'Tải thêm'; }

    // ĐỌC GIÁ TRỊ LỌC
    const filterType = document.getElementById('auditorHistoryFilterType').value;
    const filterTech = document.getElementById('auditorHistoryFilterTech').value;

    // TẠO QUERY ĐỘNG
    let historyQuery = firebase.firestore().collection('history_transactions');
    if (filterTech !== 'Tất cả') {
        historyQuery = historyQuery.where('email', '==', filterTech);
    }
    if (filterType !== 'Tất cả') {
        historyQuery = historyQuery.where('type', '==', filterType);
    }
    historyQuery = historyQuery.orderBy('timestamp', 'desc').limit(HISTORY_PAGE_SIZE);

    console.log(`[Auditor History] Đang chạy query với Filter: Tech=${filterTech}, Type=${filterType}`);

    auditorHistoryListener = historyQuery.onSnapshot(snapshot => {
        if (spinner) spinner.style.display = 'none';

        // Xử lý logic real-time phức tạp của bạn
        let hasNewChanges = false;
        snapshot.docChanges().forEach(change => {
            const docData = change.doc.data();
            const docId = docData.timestamp;
            if (change.type === 'added') {
                hasNewChanges = true;
                if (!auditorHistoryCache.find(item => item.timestamp === docId)) {
                    auditorHistoryCache.push(docData);
                }
                if (!isAuditorInitialLoad && docData.status === 'Pending') {
                    speakNotification(docData);
                }
            } else if (change.type === 'modified') {
                hasNewChanges = true;
                const index = auditorHistoryCache.findIndex(item => item.timestamp === docId);
                if (index > -1) auditorHistoryCache[index] = docData;
            } else if (change.type === 'removed') {
                hasNewChanges = true;
                auditorHistoryCache = auditorHistoryCache.filter(item => item.timestamp !== docId);
            }
        });

        isAuditorInitialLoad = false;

        // Sắp xếp lại cache (vì docChanges có thể không theo thứ tự)
        auditorHistoryCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const snapshotSize = snapshot.size;
        auditorHistoryLastDoc = (snapshotSize > 0) ? snapshot.docs[snapshotSize - 1] : null;

        if (loadMoreBtn) {
            loadMoreBtn.style.display = snapshotSize < HISTORY_PAGE_SIZE ? 'none' : 'block';
        }

        renderAuditorHistoryTable(); // Vẽ lại

    }, error => {
        console.error("Lỗi Auditor History:", error);
        if (spinner) spinner.style.display = 'none';
    });
}

function loadMoreAuditorHistory() {
    if (!auditorHistoryLastDoc) return;
    const btn = document.getElementById('loadMoreAuditorHistory');
    btn.disabled = true; btn.innerText = 'Đang tải...';

    // ĐỌC LẠI GIÁ TRỊ LỌC
    const filterType = document.getElementById('auditorHistoryFilterType').value;
    const filterTech = document.getElementById('auditorHistoryFilterTech').value;

    // TẠO QUERY ĐỘNG
    let nextQuery = firebase.firestore().collection('history_transactions');
    if (filterTech !== 'Tất cả') {
        nextQuery = nextQuery.where('email', '==', filterTech);
    }
    if (filterType !== 'Tất cả') {
        nextQuery = nextQuery.where('type', '==', filterType);
    }
    nextQuery = nextQuery.orderBy('timestamp', 'desc')
                         .startAfter(auditorHistoryLastDoc)
                         .limit(HISTORY_PAGE_SIZE);

    nextQuery.get().then(snapshot => {
        const snapshotSize = snapshot.size;
        if (snapshotSize > 0) {
            auditorHistoryLastDoc = snapshot.docs[snapshotSize - 1];
            snapshot.forEach(doc => auditorHistoryCache.push(doc.data()));
            renderAuditorHistoryTable();
        }
        btn.disabled = false; btn.innerText = 'Tải thêm';
        if (snapshotSize < HISTORY_PAGE_SIZE) btn.style.display = 'none';
    }).catch(err => {
        console.error("Lỗi tải thêm (Auditor):", err);
        btn.disabled = false; btn.innerText = 'Lỗi! Thử lại';
    });
}
function toggleAudio() {
    const btn = document.getElementById('audioToggleBtn');
    isAudioEnabled = !isAudioEnabled;
    if (isAudioEnabled) {
        btn.innerText = 'Tắt Âm thanh'; btn.style.backgroundColor = '#28a745'; btn.style.color = 'white';
        try {
            const silentAudio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=");
            silentAudio.volume = 0; silentAudio.play();
        } catch (e) {}
        speakNotification(null);
    } else {
        btn.innerText = 'Bật Âm thanh Thông báo'; btn.style.backgroundColor = '#ffc107'; btn.style.color = '#212529';
    }
}

async function speakNotification(docData) {
    if (!isAudioEnabled) return;
    let textToSpeak = '';
    if (docData === null) {
        textToSpeak = 'Đã bật âm thanh. Sẵn sàng nhận thông báo.';
    } else {
        let ktvName = docData.email; 
        if (technicianMap.has(docData.email)) ktvName = technicianMap.get(docData.email); 
        const type = docData.type; 
        let content = docData.note || '';
        if (docData.items && docData.items.length > 0) {
            content = docData.items.map(item => `${item.quantity} ${item.name}`).join(', ');
        }
        textToSpeak = `Kỹ thuật viên ${ktvName} vừa gửi yêu cầu ${type}. Nội dung: ${content}`;
    }
    try {
        if (docData !== null) { 
            chimeSound.currentTime = 0; 
            await chimeSound.play();
        }
        const delayMs = (docData === null) ? 0 : 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const response = await callApi('/tts/speak', { text: textToSpeak });
        if (response.audioUrl) {
            const audio = new Audio(response.audioUrl);
            audio.volume = 1.0; 
            audio.play().catch(e => console.warn("Lỗi phát audio Zalo:", e));
        }
    } catch (err) {
        console.error("Lỗi gọi API TTS hoặc phát chuông:", err.message);
    }
}

// === KHỞI ĐỘNG ===
document.addEventListener('DOMContentLoaded', function(){ 
    const authButton = document.getElementById('authButton');
    const signOutButton = document.getElementById('signOutButton');
    attachAuthListener(authButton, signOutButton); 
    
    // Khởi tạo Dark Mode
    // if (localStorage.getItem('darkMode') === 'true') {
    //     document.body.classList.add('dark-mode');
    // }
});