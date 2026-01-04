// functions/data-processor.js (ĐÃ REFACTOR HOÀN TOÀN SANG FIRESTORE)

const utils = require('./utils');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Hằng số Collection IDs
const PENDING_NOTES_COLLECTION = 'pending_notes';
const PENDING_RETURN_NOTES_COLLECTION = 'pending_return_notes';
const HISTORY_COLLECTION = 'history_transactions'; // MỚI
const USAGE_TICKETS_COLLECTION = 'usage_tickets'; // MỚI
let itemCodeMapCache = null;
let ticketRangesMapCache = null;
let coreCacheTimestamp = 0;
const CACHE_DURATION = 600000; // 10 phút (600,000 ms)
// === KẾT THÚC THÊM CACHE ===
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
// =======================================================
// HELPER TRUY CẬP SHEETS (CHỈ DÙNG CHO DỮ LIỆU ÍT THAY ĐỔI)
// =======================================================

/**
 * Chỉ đọc các sheet Danh mục (ít thay đổi), không đọc Lịch sử/Đối chiếu.
 * Đây là các hàm nên được cache trong tương lai.
 */
async function _readCoreSheetDataFromApi({ sheets, spreadsheetId }) {
    const itemCodeMap = new Map();
    const ticketRangesMap = [];

    try {
        // 1. Đọc Danh sách Vật tư
        const itemsResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Danh sách vật tư!A2:B',
        });
        (itemsResult.data.values || []).forEach(row => {
            if (row[0]) itemCodeMap.set(utils.normalizeCode(row[0]), row[1] || row[0]);
        });
    } catch (err) {
        console.warn("Lỗi đọc sheet Danh sách vật tư:", err.message);
    }

    try {
        // 2. Đọc Dải số sổ
        const rangesResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'TicketRanges!A2:C',
        });
        (rangesResult.data.values || []).forEach(row => {
            const emailR = row[0] || '';
            const start = Number(row[1]) || 0;
            const end = Number(row[2]) || 0;
            if (emailR && start > 0 && end >= start) {
                ticketRangesMap.push({ email: emailR, start, end });
            }
        });
    } catch (err) {
        console.warn("Lỗi đọc sheet TicketRanges:", err.message);
    }

    return { itemCodeMap, ticketRangesMap };
}
/**
 * [Hàm mới] Lấy dữ liệu lõi (Vật tư, Dải số) từ Cache hoặc API
 */
async function getCoreSheetData({ sheets, spreadsheetId }) {
    const now = Date.now();
    
    // Kiểm tra cache (cũ hơn 10 phút hoặc chưa có)
    if (!itemCodeMapCache || !ticketRangesMapCache || (now - coreCacheTimestamp > CACHE_DURATION)) {
        console.log('[Cache] Đang làm mới cache dữ liệu lõi (Vật tư, Dải số)...');
        
        // Gọi API
        const { itemCodeMap, ticketRangesMap } = await _readCoreSheetDataFromApi({ sheets, spreadsheetId });
        
        // Lưu vào cache
        itemCodeMapCache = itemCodeMap;
        ticketRangesMapCache = ticketRangesMap;
        coreCacheTimestamp = now;
        
        console.log(`[Cache] Làm mới thành công. ${itemCodeMapCache.size} vật tư, ${ticketRangesMapCache.length} dải số.`);
    } else {
        console.log('[Cache] Sử dụng cache dữ liệu lõi.');
    }
    
    return { itemCodeMap: itemCodeMapCache, ticketRangesMap: ticketRangesMapCache };
}
// =======================================================
// HELPER GHI DỮ LIỆU (DUAL WRITE)
// =======================================================

/**
 * (Async) Ghi Lịch sử vào Google Sheet (Dùng làm backup)
 * Hàm này không cần await, chạy ngầm.
 */
function writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc }) {
    const rows = [];
    const { timestamp, type, email, date, note, pendingNoteId, items } = transactionDoc;
    
    if (items && items.length > 0) {
        items.forEach(it => {
            rows.push([
                timestamp, type, email, date,
                utils.normalizeCode(it.code), it.name, Number(it.quantity) || 0,
                note, 'FIRESTORE_TX', pendingNoteId || ''
            ]);
        });
    } else {
        // Ghi note-only
        rows.push([
            timestamp, type, email, date,
            '', '', 0,
            note, 'FIRESTORE_NOTE', pendingNoteId || timestamp
        ]);
    }

    if (rows.length > 0) {
        sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Lịch sử Mượn Trả Vật Tư!A:J',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rows },
        }).catch(err => {
            console.error("!!! LỖI GHI BACKUP HISTORY SHEET:", err.message);
        });
    }
}

/**
 * (Async) Ghi Dữ liệu Excel vào Google Sheet (Dùng làm backup)
 */
function writeUsageTicketsToSheet_({ sheets, spreadsheetId, data }) {
    const rowsToAppend = data.map(r => [
        r.date || '',
        r.itemCode || '',
        r.itemName || '',
        r.ticket,
        Number(r.quantity) || 0,
        r.email || '',
        r.note || '',
        r.status || 'Chưa đối chiếu'
    ]);
    
    if (rowsToAppend.length > 0) {
         sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'Đối chiếu sổ 3 liên!A:H',
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: rowsToAppend },
        }).catch(err => {
            console.error("!!! LỖI GHI BACKUP USAGE SHEET:", err.message);
        });
    }
}

/**
 * (Async) Cập nhật trạng thái đối chiếu trên Google Sheet (Backup)
 */
async function updateUsageTicketStatusInSheet_({ sheets, spreadsheetId, tickets, email }) {
    // Logic này chậm và phức tạp, nhưng cần thiết cho backup
    try {
        const sheetName = 'Đối chiếu sổ 3 liên';
        const readResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:H`, // Đọc A-H
        });
        
        const values = readResult.data.values || [];
        const updateRequests = [];
        const ticketsToUpdate = new Set(tickets.map(t => (t || '').toString().trim()));
        const normEmail = utils.normalizeCode(email);

        for (let i = 1; i < values.length; i++) { // Bỏ qua header
            const row = values[i];
            const ticketInSheet = (row[3] || '').toString().trim(); // Cột D = Số sổ
            const emailInSheet = utils.normalizeCode(row[5] || ''); // Cột F = Email
            const statusInSheet = (row[7] || '').toString().trim(); // Cột H = Trạng thái
            const rowIndex = i + 1; // 1-based

            if (ticketsToUpdate.has(ticketInSheet) && 
                emailInSheet === normEmail && 
                statusInSheet.toLowerCase() === 'chưa đối chiếu') {
                
                updateRequests.push({
                    range: `${sheetName}!H${rowIndex}`,
                    values: [['Đã đối chiếu']]
                });
            }
        }

        if (updateRequests.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: updateRequests
                }
            });
        }
    } catch (sheetError) {
        console.error("!!! LỖI CẬP NHẬT BACKUP USAGE SHEET:", sheetError.message);
    }
}

// =======================================================
// 1. DASHBOARD DATA (Đọc 100% từ Firestore)
// =======================================================
async function getTechnicianDashboardData({ sheets, spreadsheetId, db, email, isManager }) {
    console.log(`[Firestore Dashboard] Đang tải dashboard cho: ${email}`);
    const normEmail = utils.normalizeCode(email).toLowerCase();
    
    const { itemCodeMap } = await getCoreSheetData({ sheets, spreadsheetId });

    const byCode = {};

    // A. Lấy Lịch sử Mượn/Trả từ Firestore
    try {
        const historySnapshot = await db.collection(HISTORY_COLLECTION)
            .where('email', '==', normEmail)
            .get();

        historySnapshot.forEach(doc => {
            const data = doc.data();
            const items = data.items || [];

            items.forEach(item => {
                if (!item || typeof item !== 'object') {
                    console.warn(`[getTechnicianDashboardData] Bỏ qua item không hợp lệ trong history document ${doc.id}:`, item);
                    return; 
                }

                const code = utils.normalizeCode(item.code);

                 if (!code) {
                    console.warn(`[getTechnicianDashboardData] Bỏ qua item thiếu hoặc mã không hợp lệ trong history document ${doc.id}:`, item);
                    return; 
                }

                if (!byCode[code]) {
                    byCode[code] = {
                        code,
                        name: item.name || itemCodeMap.get(code) || code,
                        quantity: 0, totalUsed: 0, totalReturned: 0,
                        unreconciledUsageDetails: [], reconciledUsageDetails: []
                    };
                }
                const itemQuantity = Number(item.quantity) || 0;

                if (data.type === 'Mượn') {
                    byCode[code].quantity += itemQuantity; 
                } else if (data.type === 'Trả' && data.status === 'Fulfilled') {
                    byCode[code].totalReturned += itemQuantity;
                }
            }); 
        }); 
    } catch (e) { 
         console.error("Lỗi đọc Firestore HISTORY_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu lịch sử.");
    }

    // B. Lấy dữ liệu Đối chiếu sổ (Usage Tickets) từ Firestore
    try {
        const usageSnapshot = await db.collection(USAGE_TICKETS_COLLECTION)
            .where('email', '==', normEmail)
            .get();
            
        usageSnapshot.forEach(doc => {
            const data = doc.data();
            const itemCode = utils.normalizeCode(data.itemCode);
            const quantityUsed = Number(data.quantity) || 0;
            
            if (!itemCode || quantityUsed <= 0) return;

            if (!byCode[itemCode]) {
                byCode[itemCode] = { 
                    code: itemCode, 
                    name: data.itemName || itemCodeMap.get(itemCode) || itemCode, 
                    quantity: 0, totalUsed: 0, totalReturned: 0, 
                    unreconciledUsageDetails: [], reconciledUsageDetails: [] 
                };
            }
            
            const detail = { 
                ticket: data.ticket, 
                quantity: quantityUsed, 
                note: data.note || '' 
            };
            
            if (data.status === 'Chưa đối chiếu') {
                byCode[itemCode].unreconciledUsageDetails.push(detail);
                byCode[itemCode].totalUsed += quantityUsed;
            } else if (data.status === 'Đã đối chiếu') {
                byCode[itemCode].reconciledUsageDetails.push(detail);
                byCode[itemCode].totalUsed += quantityUsed;
            }
        });
    } catch (e) {
         console.error("Lỗi đọc Firestore USAGE_TICKETS_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu đối chiếu.");
    }
    
    // C. Tính toán và lọc
    const items = Object.values(byCode).map(data => {
        const remaining = (data.quantity - data.totalReturned) - data.totalUsed;
        return { ...data, remaining };
    }).filter(a =>
        a.quantity > 0 ||
        a.totalReturned > 0 ||
        a.totalUsed > 0 ||
        (a.unreconciledUsageDetails && a.unreconciledUsageDetails.length > 0) ||
        (a.reconciledUsageDetails && a.reconciledUsageDetails.length > 0)
    );

    // D. Lấy Pending Notes
    let pendingNotes = [];
    try {
        const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .get();
        pendingNotes = pendingSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Lỗi đọc PENDING_NOTES_COLLECTION:", e);
    }

    let pendingReturnNotes = [];
    try {
        const pendingReturnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        pendingReturnNotes = pendingReturnSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Lỗi đọc PENDING_RETURN_NOTES_COLLECTION:", e);
    }

    return { items, pendingNotes, pendingReturnNotes };
}

// =======================================================
// 2. LỊCH SỬ (Đọc 100% từ Firestore)
// =======================================================

async function getBorrowHistory({ db, email, dateStr = null, isLast5Days = false, currentPage, pageSize }) {
    const normEmail = utils.normalizeCode(email);
    
    let query = db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('type', '==', 'Mượn')
        .orderBy('timestamp', 'desc');

    if (dateStr) {
        query = query.where('date', '==', dateStr);
    }
    if (isLast5Days) {
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
        query = query.where('timestamp', '>=', fiveDaysAgo.toISOString());
    }

    const totalSnapshot = await query.get();
    const totalItems = totalSnapshot.size;
    const totalPages = Math.ceil(totalItems / pageSize);

    const pageQuery = query
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
        
    const historySnapshot = await pageQuery.get();

    const history = historySnapshot.docs.map(doc => {
        const data = doc.data();
        
        const itemsEntered = {};
        if (data.items) {
            data.items.forEach(item => {
                itemsEntered[utils.normalizeCode(item.code)] = {
                    code: item.code,
                    name: item.name,
                    quantity: item.quantity
                };
            });
        }
        
        return {
            timestamp: data.timestamp,
            date: data.date,
            note: data.note,
            status: data.status,
            reason: data.rejectionReason || null,
            itemsEntered: itemsEntered
        };
    });
    
    return { history, totalPages };
}

async function getReturnHistory({ db, email, currentPage, pageSize }) {
    const normEmail = utils.normalizeCode(email);
    
    let query = db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('type', '==', 'Trả')
        .orderBy('timestamp', 'desc');

    const totalSnapshot = await query.get();
    const totalItems = totalSnapshot.size;
    const totalPages = Math.ceil(totalItems / pageSize);

    const pageQuery = query
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
        
    const historySnapshot = await pageQuery.get();

    const history = historySnapshot.docs.map(doc => {
        const data = doc.data();
        const itemsEntered = {};
        if (data.items) {
            data.items.forEach(item => {
                itemsEntered[utils.normalizeCode(item.code)] = {
                    code: item.code,
                    name: item.name,
                    quantity: item.quantity
                };
            });
        }
        return {
            timestamp: data.timestamp,
            date: data.date,
            note: data.note,
            status: data.status,
            reason: data.rejectionReason || null,
            itemsEntered: itemsEntered
        };
    });
    
    return { history, totalPages };
}


// =======================================================
// 3. SUBMIT TRANSACTION (Ghi vào Firestore & Sheets)
// =======================================================
async function submitTransaction({ sheets, spreadsheetId, db, data }) {
    const ts = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();
    const batch = db.batch();
    let transactionDoc; 

    if (data.type === 'Mượn') {
        const items = data.items || [];
        const note = data.note || '';
        const pendingNoteId = data.borrowTimestamp || '';
        const currentTs = ts;

        const isKtvSubmitNote = !pendingNoteId && data.mode !== 'DIRECT' && items.length === 0;
        const isManagerConfirmNote = !!pendingNoteId && items.length > 0;
        const isManagerDirect = data.mode === 'DIRECT' && items.length > 0;

        if (isKtvSubmitNote) {
            const selfNoteId = currentTs;
            const pendingNoteRefById = db.collection(PENDING_NOTES_COLLECTION).doc(selfNoteId);
            batch.set(pendingNoteRefById, { timestamp: selfNoteId, type: 'Mượn', email: data.email, date: data.date, note: note, isFulfilled: false, status: 'Pending', createdAt: new Date().toISOString() });
            const historyNoteDoc = { timestamp: selfNoteId, email: data.email, type: 'Mượn', date: data.date, note: note, items: [], status: 'Pending', pendingNoteId: selfNoteId };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(selfNoteId);
            batch.set(historyRef, historyNoteDoc);
            transactionDoc = historyNoteDoc;

        } else if (isManagerConfirmNote) {
            const historyDocIdToUpdate = pendingNoteId;
            const historyRefToUpdate = db.collection(HISTORY_COLLECTION).doc(historyDocIdToUpdate);
            const pendingNoteRef = db.collection(PENDING_NOTES_COLLECTION).doc(pendingNoteId);
            let technicianNote = '';
            try { const pendingDocSnap = await pendingNoteRef.get(); if (pendingDocSnap.exists) { technicianNote = pendingDocSnap.data().note || ''; } } catch (e) { console.error(`Error fetching pending note ${pendingNoteId}:`, e); }
            const finalNote = note || technicianNote;
            const updateData = { items, status: 'Fulfilled', note: finalNote, fulfilledTimestamp: currentTs };
            batch.update(historyRefToUpdate, updateData);
            await fulfillPendingNote_({ db, email: data.email, tsISO: pendingNoteId, batch });
             transactionDoc = { timestamp: historyDocIdToUpdate, email: data.email, type: 'Mượn', date: data.date, note: updateData.note, items: updateData.items, status: 'Fulfilled', pendingNoteId: pendingNoteId };

        } else if (isManagerDirect) {
            const directBorrowDoc = { timestamp: currentTs, email: data.email, type: 'Mượn', date: data.date, note: note, items: items, status: 'Fulfilled', pendingNoteId: '' };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(currentTs);
            batch.set(historyRef, directBorrowDoc);
            transactionDoc = directBorrowDoc;
        } else {
             throw new Error("Lỗi logic xử lý yêu cầu mượn.");
        }

        await batch.commit();

        if (transactionDoc) {
            writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc });
        }

    } else if (data.type === 'Trả') {
        const tickets = data.tickets || [];
        const itemsR = data.items || [];
        const note = data.note || '';
        const currentTs = ts;

        const isKtvReconcile = tickets.length > 0;
        const isManagerDirectReturn = data.mode === 'MANAGER_DIRECT' && itemsR.length > 0;
        const isManagerConfirmNote = !!data.returnTimestamp && itemsR.length > 0; 
        const isKtvSubmitPendingReturn = !isKtvReconcile && !isManagerConfirmNote && !isManagerDirectReturn && (itemsR.length > 0 || !!note);

        if (isKtvSubmitPendingReturn) {
            const selfNoteId = currentTs;
            const historyItems = (itemsR || []).map(it => ({ code: it.code, name: it.name, quantity: it.quantityReturned || it.quantity || 0 }));
            
            const pendingNoteRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc(selfNoteId);
            batch.set(pendingNoteRef, { timestamp: selfNoteId, type: 'Trả', email: data.email, date: data.date, note: note, items: historyItems, isFulfilled: false, status: 'Pending', createdAt: new Date().toISOString() });
            
            transactionDoc = { timestamp: selfNoteId, email: data.email, type: 'Trả', date: data.date, note: note, items: historyItems, status: 'Pending', pendingNoteId: selfNoteId };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(selfNoteId);
            batch.set(historyRef, transactionDoc);
            
            await batch.commit();

        } else if (isKtvReconcile) {
            const normEmail = utils.normalizeCode(data.email);
            const allTicketsToUpdate = (tickets || []).map(t => (t || '').toString().trim());
            
            const CHUNK_SIZE = 30;
            const ticketChunks = chunkArray(allTicketsToUpdate, CHUNK_SIZE);
            
            let totalUpdated = 0;

            for (const ticketChunk of ticketChunks) {
                const chunkBatch = db.batch(); 
                
                const usageQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                    .where('email', '==', normEmail)
                    .where('ticket', 'in', ticketChunk) 
                    .where('status', '==', 'Chưa đối chiếu')
                    .get();

                if (!usageQuery.empty) {
                    usageQuery.forEach(doc => {
                        chunkBatch.update(doc.ref, { status: 'Đã đối chiếu' });
                    });
                    
                    await chunkBatch.commit(); 
                    totalUpdated += usageQuery.size;
                }
            } 

            if (totalUpdated === 0) {
                throw new Error("Không tìm thấy số sổ nào hợp lệ để đối chiếu.");
            }

            updateUsageTicketStatusInSheet_({ sheets, spreadsheetId, tickets: allTicketsToUpdate, email: normEmail });
            
            return { ok: true, updated: totalUpdated }; 

        } else if (isManagerConfirmNote) {
            const historyDocIdToUpdate = data.returnTimestamp;
            const historyRefToUpdate = db.collection(HISTORY_COLLECTION).doc(historyDocIdToUpdate);
            const pendingNoteRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc(historyDocIdToUpdate);

            let technicianNote = '';
            try {
                const pendingDocSnap = await pendingNoteRef.get();
                if (pendingDocSnap.exists) technicianNote = pendingDocSnap.data().note || '';
            } catch (e) { console.error(`Error fetching pending return note ${historyDocIdToUpdate}:`, e); }

            const finalNote = note || technicianNote;
            const updateItems = itemsR.map(it => ({ code: it.code, name: it.name, quantity: it.quantityReturned || it.quantity || 0 }));
            
            const updateData = { items: updateItems, status: 'Fulfilled', note: finalNote, fulfilledTimestamp: currentTs };
            batch.update(historyRefToUpdate, updateData);

            await fulfillPendingReturnNote_({ db, email: data.email, tsISO: historyDocIdToUpdate, batch });

            transactionDoc = { timestamp: historyDocIdToUpdate, email: data.email, type: 'Trả', date: data.date, note: updateData.note, items: updateData.items, status: 'Fulfilled', pendingNoteId: historyDocIdToUpdate };
            await batch.commit();

        } else if (isManagerDirectReturn) {
            const historyItems = (itemsR || []).map(it => ({ code: it.code, name: it.name, quantity: it.quantityReturned || it.quantity || 0 }));
            
            transactionDoc = { 
                timestamp: currentTs, 
                email: data.email, 
                type: 'Trả', 
                date: data.date,
                note: note, 
                items: historyItems, 
                status: 'Fulfilled',
                pendingNoteId: ''
            };
            const historyRef = db.collection(HISTORY_COLLECTION).doc(currentTs);
            batch.set(historyRef, transactionDoc);
            await batch.commit();
        }

        if (transactionDoc) {
            writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc });
        }

    } else {
         throw new Error("Loại giao dịch không hợp lệ.");
    }

    return true;
}

// =======================================================
// 4. XỬ LÝ EXCEL (Ghi vào Firestore & Sheets)
// =======================================================
async function saveExcelData({ sheets, spreadsheetId, db, data }) {
    if (!data || data.length === 0) {
        throw new Error('Không có dữ liệu hợp lệ để lưu.');
    }

    let totalNew = 0;
    let totalDeleted = 0;
    const batchSize = 450; 

    const dataChunks = chunkArray(data, batchSize);

    for (const chunk of dataChunks) {
        const batch = db.batch();
        let newCountInChunk = 0;

        const ticketsInChunk = [...new Set(chunk.map(r => r.ticket).filter(t => t))];

        if (ticketsInChunk.length > 0) {
            const ticketSubChunks = chunkArray(ticketsInChunk, 30);
            
            for (const subChunk of ticketSubChunks) {
                const deleteQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                    .where('ticket', 'in', subChunk)
                    .where('status', '==', 'Chưa đối chiếu')
                    .get();
                
                if (!deleteQuery.empty) {
                    deleteQuery.forEach(doc => {
                        batch.delete(doc.ref);
                        totalDeleted++;
                    });
                }
            }
        }
        
        const reconciledItems = new Set();
        if (ticketsInChunk.length > 0) {
             const ticketSubChunks = chunkArray(ticketsInChunk, 30);
             for (const subChunk of ticketSubChunks) {
                const reconciledQuery = await db.collection(USAGE_TICKETS_COLLECTION)
                    .where('ticket', 'in', subChunk)
                    .where('status', '==', 'Đã đối chiếu')
                    .get();

                if (!reconciledQuery.empty) {
                    reconciledQuery.docs.forEach(doc => {
                        const key = doc.data().ticket + '|' + doc.data().itemCode;
                        reconciledItems.add(key);
                    });
                }
             }
        }

        chunk.forEach(r => {
            const docData = {
                date: r.date || '',
                monthYear: r.monthYear || '',
                itemCode: utils.normalizeCode(r.itemCode || ''),
                itemName: r.itemName || '',
                ticket: r.ticket || '',
                quantity: Number(r.quantity) || 0,
                email: r.email || '',
                note: r.note || '',
                itemGroup: r.itemGroup || '', // Thêm trường nhóm vật tư
                status: 'Chưa đối chiếu' // Luôn đặt là "Chưa đối chiếu"
            };

            if (docData.ticket && docData.itemCode) {
                const key = docData.ticket + '|' + docData.itemCode;
                
                if (!reconciledItems.has(key)) {
                    const newRef = db.collection(USAGE_TICKETS_COLLECTION).doc();
                    batch.set(newRef, docData);
                    newCountInChunk++;
                }
            }
        });

        await batch.commit();
        totalNew += newCountInChunk;
        
        const newDataToBackup = chunk.filter(r => {
             const key = (r.ticket || '') + '|' + utils.normalizeCode(r.itemCode || '');
             return r.ticket && r.itemCode && !reconciledItems.has(key);
        });
        
        if (newDataToBackup.length > 0) {
            writeUsageTicketsToSheet_({ sheets, spreadsheetId, data: newDataToBackup });
        }
    } 

    return { ok: true, message: `Lưu thành công. Đã xóa ${totalDeleted} vật tư cũ, thêm mới ${totalNew} vật tư.` };
}


// =======================================================
// 5. CÁC HÀM QUẢN LÝ (Helper)
// =======================================================

async function fulfillPendingNote_({ db, email, tsISO, batch }) {
    const normEmail = utils.normalizeCode(email);

    const docRef = db.collection(PENDING_NOTES_COLLECTION).doc(tsISO);

    const docSnap = await docRef.get();

    if (docSnap.exists && docSnap.data().isFulfilled === false && docSnap.data().email === normEmail) {
        batch.update(docRef, {
            isFulfilled: true,
            status: 'Fulfilled',
            fulfilledAt: new Date().toISOString()
        });
    } else if (!docSnap.exists) {
         console.warn(`[fulfillPendingNote_] Pending note with ID ${tsISO} not found.`);
    } else if (docSnap.data().isFulfilled === true) {
         console.warn(`[fulfillPendingNote_] Pending note ${tsISO} was already fulfilled.`);
    } else if (docSnap.data().email !== normEmail) {
         console.warn(`[fulfillPendingNote_] Email mismatch for pending note ${tsISO}. Expected ${normEmail}, found ${docSnap.data().email}`);
    }
}

async function fulfillPendingReturnNote_({ db, email, tsISO, batch }) {
    const normEmail = utils.normalizeCode(email);
    const docRef = db.collection(PENDING_RETURN_NOTES_COLLECTION).doc(tsISO);

    const docSnap = await docRef.get();

    if (docSnap.exists && docSnap.data().isFulfilled === false && docSnap.data().email === normEmail) {
        batch.update(docRef, {
            isFulfilled: true,
            status: 'Fulfilled',
            fulfilledAt: new Date().toISOString()
        });
    } else {
         if (!docSnap.exists) { console.warn(`[fulfillPendingReturnNote_] Not updating: Pending return note ${tsISO} not found.`); }
         else if (docSnap.data().isFulfilled === true) { console.warn(`[fulfillPendingReturnNote_] Not updating: Pending return note ${tsISO} already fulfilled.`); }
         else if (docSnap.data().email !== normEmail) { console.warn(`[fulfillPendingReturnNote_] Not updating: Email mismatch for pending return note ${tsISO}.`); }
         else { console.warn(`[fulfillPendingReturnNote_] Not updating note ${tsISO} for unknown reason.`); }
    }
}

async function rejectPendingBorrowNote_({ db, email, tsISO, reason }) {
    const normEmail = utils.normalizeCode(email);
    const batch = db.batch();

    const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .where('isFulfilled', '==', false)
        .limit(1)
        .get();

    if (pendingSnapshot.empty) {
         throw new Error('Không tìm thấy note mượn hàng đang chờ.');
    }
    
    const pendingDocRef = pendingSnapshot.docs[0].ref;
    batch.update(pendingDocRef, {
        isFulfilled: true,
        status: 'Rejected',
        rejectionReason: reason,
        fulfilledAt: new Date().toISOString()
    });

    const historySnapshot = await db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .limit(1)
        .get();
        
    if (!historySnapshot.empty) {
        const historyDocRef = historySnapshot.docs[0].ref;
        batch.update(historyDocRef, {
            status: 'Rejected',
            rejectionReason: reason
        });
    }
    
    await batch.commit();
    return true;
}

async function rejectPendingReturnNote_({ db, email, tsISO, reason }) {
    const normEmail = utils.normalizeCode(email);
    const batch = db.batch();

    const pendingSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .where('isFulfilled', '==', false)
        .limit(1)
        .get();

    if (pendingSnapshot.empty) {
         throw new Error('Không tìm thấy note trả hàng đang chờ.');
    }
    
    const pendingDocRef = pendingSnapshot.docs[0].ref;
    batch.update(pendingDocRef, {
        isFulfilled: true,
        status: 'Rejected',
        rejectionReason: reason,
        fulfilledAt: new Date().toISOString()
    });

    const historySnapshot = await db.collection(HISTORY_COLLECTION)
        .where('email', '==', normEmail)
        .where('timestamp', '==', tsISO)
        .limit(1)
        .get();
        
    if (!historySnapshot.empty) {
        const historyDocRef = historySnapshot.docs[0].ref;
        batch.update(historyDocRef, {
            status: 'Rejected',
            rejectionReason: reason
        });
    }
    
    await batch.commit();
    return true;
}

// =======================================================
// 6. CÁC HÀM CÒN LẠI (Ít thay đổi)
// =======================================================
async function getTechnicians({ db }) {
    const techSnapshot = await db.collection('technicians').orderBy('name').get();

    if (techSnapshot.empty) {
        console.warn("Không tìm thấy KTV nào trong collection 'technicians'.");
        return [];
    }

    const techList = [];
    techSnapshot.forEach(doc => {
        techList.push(doc.data());
    });

    return techList;
}

async function getItemList({ sheets, spreadsheetId }) {
    const sheetName = 'Danh sách vật tư';
    const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:B`,
    });
    return (result.data.values || [])
        .filter(row => row[0])
        .map(row => ({
            code: utils.normalizeCode(row[0]),
            name: row[1] ? row[1].toString().trim() : ''
        }));
}

async function getTicketRanges({ sheets, spreadsheetId, email }) {
    const { ticketRangesMap } = await getCoreSheetData({ sheets, spreadsheetId });
    const normEmail = utils.normalizeCode(email);
    
    return ticketRangesMap
        .filter(r => r.email === normEmail)
        .map(r => ({ start: r.start, end: r.end }))
        .sort((a, b) => a.start - b.start);
}

async function saveTicketRanges({ sheets, spreadsheetId, email, ranges }) {
    const sheetName = 'TicketRanges';
    const normEmail = utils.normalizeCode(email);
    const newTimestamp = new Date().toISOString();

    try {
        const readResult = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:E`,
        });
        const allValues = readResult.data.values || [];

        const otherUserRows = allValues.filter(row => {
            const rowEmail = utils.normalizeCode(row[0] || '');
            return rowEmail && rowEmail !== normEmail;
        });

        const currentUserRows = (ranges || []).map(r => [
            email, 
            r.start, 
            r.end, 
            newTimestamp,
            newTimestamp
        ]);

        const finalData = [
            ...otherUserRows,
            ...currentUserRows
        ];

        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetName}!A2:E`,
        });

        if (finalData.length > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A2`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: finalData
                },
            });
        }

        return { ok: true, message: `Lưu ${currentUserRows.length} dải số thành công.` };

    } catch (err) {
        console.error("Lỗi nghiêm trọng khi saveTicketRanges:", err);
        throw new Error("Lỗi khi cập nhật Google Sheet: " + err.message);
    }
}

async function submitErrorReport({ sheets, spreadsheetId, data }) {
    const rows = [[
        new Date().toISOString(), data.email || '', data.errorType || '',
        data.description || '', data.relatedTicketOrDate || '', data.suggestedFix || ''
    ]];
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Báo cáo sai sót!A:F', 
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: rows },
    });
    return true;
}

async function processExcelData({ sheets, spreadsheetId, data }) {
    const { ticketRangesMap } = await getCoreSheetData({ sheets, spreadsheetId });
    const processed = (data || []).map(row => {
        let parsedDate = row.date;
        let dateObj = null;
        
        if (typeof parsedDate === 'number') { // Excel date serial number
            dateObj = new Date((parsedDate - 25569) * 86400 * 1000);
        } else if (typeof parsedDate === 'string' && parsedDate.includes('/')) { // DD/MM/YYYY string
            const parts = parsedDate.split('/');
            if (parts.length === 3) {
                // new Date(year, monthIndex, day)
                dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
            }
        }

        if (dateObj && !isNaN(dateObj.getTime())) {
            parsedDate = utils.fmtDate(dateObj);
        } else {
            dateObj = null; // Invalid date
        }

        let ticket = (row.ticket == null) ? '' : String(row.ticket);
        if (ticket && !/^Sổ\s+/i.test(ticket)) ticket = 'Sổ ' + ticket.replace(/^Sổ\s*/i, '').trim();
        let email = row.email || '';
        const numMatch = ticket.match(/\d+/);
        if (!email && numMatch) {
            const num = parseInt(numMatch[0], 10);
            if (isFinite(num)) {
                email = utils.getEmailByTicketNumber(num, ticketRangesMap);
            }
        }
        return {
            date: parsedDate || row.date || '',
            monthYear: dateObj ? `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}` : '',
            itemCode: utils.normalizeCode(row.itemCode || ''),
            itemName: (row.itemName || '').toString().trim(),
            ticket: ticket,
            quantity: Number(row.quantity) || 0,
            email: (email || '').toString().trim(),
            note: row.note || '',
            itemGroup: (row['Nhóm VTHH'] || '').toString().trim()
        };
    });
    return processed;
}

async function verifyAndRegisterUser({ db, email, name }) {
    const normEmail = utils.normalizeCode(email);

    const techRef = db.collection('technicians').doc(normEmail);

    const doc = await techRef.get();

    if (!doc.exists) {
        await techRef.set({
            email: email,
            name: name || email,
            createdAt: new Date().toISOString()
        });
    }
    return { email, name };
}

async function rejectReturnNote({ db, data }) {
    return rejectPendingReturnNote_({
        db, 
        email: data.email,
        tsISO: data.timestamp,
        reason: data.reason
    });
}

async function rejectBorrowNote({ db, data }) {
    return rejectPendingBorrowNote_({
        db, 
        email: data.email,
        tsISO: data.timestamp,
        reason: data.reason
    });
}

async function getPendingCounts({ db }) {
    let pendingBorrowEmails = [];
    let pendingReturnEmails = [];
    try {
        const borrowSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        const borrowEmailsSet = new Set();
        borrowSnapshot.forEach(doc => doc.data().email && borrowEmailsSet.add(doc.data().email));
        pendingBorrowEmails = Array.from(borrowEmailsSet);

        const returnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        const returnEmailsSet = new Set();
        returnSnapshot.forEach(doc => doc.data().email && returnEmailsSet.add(doc.data().email));
        pendingReturnEmails = Array.from(returnEmailsSet);

        return { pendingBorrowEmails, pendingReturnEmails };
    } catch (error) {
        console.error("Error getting pending counts/emails:", error);
        return { pendingBorrowEmails: [], pendingReturnEmails: [] };
    }
}

async function managerTransferItems({ sheets, spreadsheetId, db, data }) {
    const { fromEmail, toEmail, date, items } = data;

    if (!fromEmail || !toEmail || !date || !items || items.length === 0) {
        throw new Error('Thiếu thông tin người chuyển, người nhận, ngày hoặc vật tư.');
    }
    if (fromEmail === toEmail) {
        throw new Error('Người chuyển và người nhận phải khác nhau.');
    }
    
    let fromName = fromEmail;
    let toName = toEmail;
    try {
        const techResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Danh sách kỹ thuật viên!A2:B',
        });
        const techs = techResponse.data.values || [];
        
        const techMap = new Map(techs.map(row => [utils.normalizeCode(row[0]), row[1] || row[0]]));
        
        fromName = techMap.get(utils.normalizeCode(fromEmail)) || fromEmail;
        toName = techMap.get(utils.normalizeCode(toEmail)) || toEmail;
        
    } catch (sheetError) {
         console.warn("Không thể lấy tên KTV từ Sheet, sẽ dùng Email:", sheetError.message);
    }

    const timestamp = new Date().toISOString();
    const batch = db.batch();

    const returnTx = {
        timestamp: timestamp, 
        email: fromEmail, 
        type: 'Trả', 
        date: date,
        note: `Chuyển cho ${toName}`,
        items: items, 
        status: 'Fulfilled',
        pendingNoteId: ''
    };
    const returnRef = db.collection(HISTORY_COLLECTION).doc();
    batch.set(returnRef, returnTx);
    
    const borrowTx = {
        timestamp: timestamp, 
        email: toEmail, 
        type: 'Mượn', 
        date: date,
        note: `Nhận từ ${fromName}`,
        items: items, 
        status: 'Fulfilled',
        pendingNoteId: ''
    };
    const borrowRef = db.collection(HISTORY_COLLECTION).doc();
    batch.set(borrowRef, borrowTx);

    await batch.commit();

    writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: returnTx });
    writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: borrowTx });

    return { ok: true, message: 'Chuyển vật tư thành công.' };
}

async function getSpeechAudio({ text }) {
    const ZALO_API_KEY = process.env.ZALO_API_KEY; 
    if (!ZALO_API_KEY) {
        throw new Error('ZALO_API_KEY is not set in environment variables.');
    }

    const params = new URLSearchParams();
    params.append('input', text);
    params.append('speaker_id', '6');
    params.append('encode_type', '1');

    try {
        const response = await fetch('https://api.zalo.ai/v1/tts/synthesize', {
            method: 'POST',
            headers: {
              'apikey': ZALO_API_KEY,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const result = await response.json();

        if (result.error_code !== 0) {
            throw new Error(`ZaloTTS Error ${result.error_code}: ${result.error_message}`);
        }

        return { audioUrl: result.data.url };

    } catch (err) {
        throw new Error("Không thể tạo âm thanh từ ZaloTTS API.");
    }
}

async function getPendingBorrowNotesForTech({ db, email }) {
    const normEmail = utils.normalizeCode(email).toLowerCase();
    try {
        const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .get();
        return pendingSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error(`Lỗi khi đọc PENDING_NOTES_COLLECTION cho ${email}:`, e);
        return [];
    }
}

async function getSelfPendingBorrowNotes({ db, user }) {
    const normEmail = utils.normalizeCode(user.email).toLowerCase();

    try {
        const pendingSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .where('status', '==', 'Pending')
            .orderBy('timestamp', 'desc')
            .get();
            
        return pendingSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error(`Lỗi khi đọc PENDING_NOTES_COLLECTION cho ${user.email}:`, e);
        return [];
    }
}

async function getPendingReturnNotesForTech({ db, email }) {
    const normEmail = utils.normalizeCode(email).toLowerCase();
    try {
        const pendingSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('email', '==', normEmail)
            .where('isFulfilled', '==', false)
            .get();
        return pendingSnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error(`Lỗi khi đọc PENDING_RETURN_NOTES_COLLECTION cho ${email}:`, e);
        return [];
    }
}

async function getAllPendingNotes({ db }) {
    let allNotes = [];

    const techs = await getTechnicians({ db });
    const techMap = new Map(techs.map(t => [t.email, t.name]));

    try {
        const borrowSnapshot = await db.collection(PENDING_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        borrowSnapshot.forEach(doc => {
            const data = doc.data();
            allNotes.push({
                ...data,
                name: techMap.get(data.email) || data.email
            });
        });
    } catch (error) {
        console.error("Error fetching pending borrow notes:", error);
    }

    try {
        const returnSnapshot = await db.collection(PENDING_RETURN_NOTES_COLLECTION)
            .where('isFulfilled', '==', false)
            .where('status', 'not-in', ['Rejected'])
            .get();
        returnSnapshot.forEach(doc => {
            const data = doc.data();
            allNotes.push({
                ...data,
                name: techMap.get(data.email) || data.email
            });
        });
    } catch (error) {
        console.error("Error fetching pending return notes:", error);
    }

    allNotes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return allNotes;
}

async function getGlobalInventoryOverview({ sheets, spreadsheetId, db }) {

    const { itemCodeMap } = await getCoreSheetData({ sheets, spreadsheetId });

    const byCodeAndEmail = {}; 

    try {
        const historySnapshot = await db.collection(HISTORY_COLLECTION).get();

        historySnapshot.forEach(doc => {
            const data = doc.data();
            const items = data.items || [];
            const email = data.email || '';

            if (!email) return;

            items.forEach(item => {
                if (!item || !item.code) return; 
                const code = utils.normalizeCode(item.code);

                if (!byCodeAndEmail[code]) byCodeAndEmail[code] = {};
                if (!byCodeAndEmail[code][email]) {
                    byCodeAndEmail[code][email] = { 
                        name: item.name || itemCodeMap.get(code) || code, 
                        totalBorrowed: 0, 
                        totalUsed: 0, 
                        totalReturned: 0 
                    };
                }

                const itemQuantity = Number(item.quantity) || 0;
                if (data.type === 'Mượn') {
                    byCodeAndEmail[code][email].totalBorrowed += itemQuantity;
                } else if (data.type === 'Trả' && data.status === 'Fulfilled') {
                    byCodeAndEmail[code][email].totalReturned += itemQuantity;
                }
            });
        });
    } catch (e) {
         console.error("Lỗi đọc Global HISTORY_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu lịch sử toàn hệ thống.");
    }

    try {
        const usageSnapshot = await db.collection(USAGE_TICKETS_COLLECTION).get();

        usageSnapshot.forEach(doc => {
            const data = doc.data();
            const itemCode = utils.normalizeCode(data.itemCode);
            const quantityUsed = Number(data.quantity) || 0;
            const email = data.email || '';

            if (!itemCode || quantityUsed <= 0 || !email) { 
                return; 
            }

            if (data.status === 'Chưa đối chiếu' || data.status === 'Đã đối chiếu') {
                if (!byCodeAndEmail[itemCode]) byCodeAndEmail[itemCode] = {};
                if (!byCodeAndEmail[itemCode][email]) {
                     byCodeAndEmail[itemCode][email] = { 
                         name: data.itemName || itemCodeMap.get(itemCode) || itemCode, 
                         totalBorrowed: 0, totalUsed: 0, totalReturned: 0 
                     };
                }
                byCodeAndEmail[itemCode][email].totalUsed += quantityUsed;
            }
        });
    } catch (e) {
         console.error("Lỗi đọc Global USAGE_TICKETS_COLLECTION:", e);
         throw new Error("Lỗi tải dữ liệu đối chiếu toàn hệ thống.");
    }

    const overviewList = [];

    for (const code in byCodeAndEmail) {
        const emails = byCodeAndEmail[code];
        let totalBorrowed = 0;
        let totalUsed = 0;
        let totalReturned = 0;
        const debtors = [];

        for (const email in emails) {
            const data = emails[email];
            const remaining = (data.totalBorrowed - data.totalReturned) - data.totalUsed;

            totalBorrowed += data.totalBorrowed;
            totalUsed += data.totalUsed;
            totalReturned += data.totalReturned;

            if (remaining !== 0) {
                debtors.push({
                    email: email,
                    remaining: remaining
                });
            }
        }

        const totalRemaining = (totalBorrowed - totalReturned) - totalUsed;

        if (totalRemaining !== 0) {
            overviewList.push({
                code: code,
                name: emails[Object.keys(emails)[0]].name,
                totalBorrowed: totalBorrowed,
                totalUsed: totalUsed,
                totalReturned: totalReturned,
                remaining: totalRemaining,
                debtors: debtors
            });
        }
    }

    overviewList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return overviewList;
}

async function fixNegativeInventory({ sheets, spreadsheetId, db, email, itemCode, itemName, amountToFix }) {

    const timestamp = new Date().toISOString();
    const date = new Date().toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});

    const adjustmentTx = {
        timestamp: timestamp,
        email: email,
        type: 'Mượn',
        date: date,
        note: `Điều chỉnh kho âm (Tự động)`,
        items: [{
            code: itemCode,
            name: itemName,
            quantity: Number(amountToFix) || 0
        }],
        status: 'Fulfilled',
        pendingNoteId: '',
        mode: 'ADJUSTMENT'
    };

    const historyRef = db.collection('history_transactions').doc(timestamp);
    await historyRef.set(adjustmentTx);

    writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: adjustmentTx });

    return { ok: true, message: 'Điều chỉnh kho thành công.' };
}

async function fixNegativeInventoryBatch({ sheets, spreadsheetId, db, email, itemsToFix }) {
    const batch = db.batch();
    const timestampBase = new Date().getTime();
    const date = new Date(timestampBase).toLocaleString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'});

    for (let i = 0; i < itemsToFix.length; i++) {
        const item = itemsToFix[i];

        const amountToFix = Math.abs(Number(item.remaining) || 0);

        if (amountToFix === 0) continue; 

        const docTimestamp = new Date(timestampBase + i).toISOString(); 

        const adjustmentTx = {
            timestamp: docTimestamp,
            email: email,
            type: 'Mượn',
            date: date,
            note: `Điều chỉnh kho âm (Tự động)`,
            items: [{
                code: item.code,
                name: item.name,
                quantity: amountToFix
            }],
            status: 'Fulfilled',
            mode: 'ADJUSTMENT'
        };

        const historyRef = db.collection('history_transactions').doc(docTimestamp);
        batch.set(historyRef, adjustmentTx);

        writeHistoryToSheet_({ sheets, spreadsheetId, transactionDoc: adjustmentTx });
    }

    await batch.commit(); 

    return { ok: true, message: `Điều chỉnh kho thành công cho ${itemsToFix.length} vật tư.` };
}

async function updateTechnicianAvatar({ db, email, avatarUrl }) {
    if (!email || !avatarUrl) {
        throw new Error("Thiếu email hoặc URL ảnh đại diện.");
    }
    const normEmail = utils.normalizeCode(email);
    const techRef = db.collection('technicians').doc(normEmail);

    try {
        await techRef.update({
            avatarUrl: avatarUrl
        });
        return { ok: true, message: "Cập nhật ảnh đại diện thành công." };
    } catch (error) {
        throw new Error("Không thể cập nhật ảnh. User có thể không tồn tại trong danh sách KTV.");
    }
}

async function createRepairTicket({ db, data }) {
    const { creatorEmail, creatorName, customer, device, status, photos } = data;
    
    const counterRef = db.collection('counters').doc('repair_tickets');
    
    const ticketId = await db.runTransaction(async (t) => {
        const doc = await t.get(counterRef);
        let newCount = 1;
        if (doc.exists) {
            newCount = doc.data().current + 1;
        }
        
        const year = new Date().getFullYear().toString().substr(-2);
        const idStr = newCount.toString().padStart(4, '0');
        const fullId = `SC${year}-${idStr}`;
        
        t.set(counterRef, { current: newCount }, { merge: true });
        
        return fullId;
    });

    const ticketDoc = {
        ticketId: ticketId,
        createdAt: new Date().toISOString(),
        createdBy: creatorEmail,
        creatorName: creatorName || creatorEmail,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        
        deviceType: device.type,
        deviceBrand: device.brand,
        deviceModel: device.model,
        deviceSerial: device.serial,
        accessories: device.accessories,
        
        currentStatus: 'Mới nhận',
        issueDescription: status.description,
        physicalCondition: status.physicalCondition,
        
        receivePhotos: photos || [],
        
        techCheck: null,
        quotation: null,
        repair: null,
        payment: null,
        
        searchKeywords: [
            ticketId.toLowerCase(), 
            customer.phone, 
            utils.normalizeCode(customer.name)
        ]
    };

    await db.collection('repair_tickets').doc(ticketId).set(ticketDoc);

    await db.collection('repair_logs').add({
        ticketId: ticketId,
        timestamp: new Date().toISOString(),
        user: creatorName,
        action: 'Tạo phiếu tiếp nhận',
        details: `Đã nhận máy. Lỗi: ${status.description}`
    });

    return { ok: true, ticketId: ticketId };
}

async function getRepairTickets({ db, status = '', search = '', month = '', lastTicketId = null }) {
    let query = db.collection('repair_tickets').orderBy('createdAt', 'desc');

    if (month && /^\d{4}-\d{2}$/.test(month)) {
        try {
            const [year, monthNum] = month.split('-').map(Number);
            
            const startDate = new Date(Date.UTC(year, monthNum - 1, 1));
            
            const endDate = new Date(Date.UTC(year, monthNum, 0, 23, 59, 59, 999));

            query = query.where('createdAt', '>=', startDate.toISOString())
                         .where('createdAt', '<=', endDate.toISOString());
        } catch(e) {
            console.error("Lỗi parse tháng không hợp lệ:", month, e);
        }
    } else {
        const INCOMPLETE_STATUSES = [
            'Mới nhận', 'Đang kiểm tra', 'Chờ báo giá', 'Chờ khách xác nhận', 
            'Đang sửa', 'Chờ trả máy', 'Trả máy không sửa', 'Chờ đặt hàng', 
            'Đã có hàng', 'Đang sửa ngoài'
        ];

        if (status === 'Hoàn tất') {
            query = query.where('currentStatus', '==', 'Hoàn tất');
        } else if (status === 'Chưa hoàn tất') {
            const incompleteChunks = chunkArray(INCOMPLETE_STATUSES, 10);
            if(incompleteChunks.length > 0) {
                 query = query.where('currentStatus', 'in', incompleteChunks[0]);
            }
        } else if (status && status !== 'Tất cả' && status !== '') {
            query = query.where('currentStatus', '==', status);
        }
    }

    if (search) {
        const snapshot = await query.limit(50).get();
        let tickets = snapshot.docs.map(doc => doc.data());
        const searchLower = search.toLowerCase();
        
        return tickets.filter(t => 
            (t.ticketId && t.ticketId.toLowerCase().includes(searchLower)) ||
            (t.customerName && t.customerName.toLowerCase().includes(searchLower)) ||
            (t.customerPhone && t.customerPhone.includes(search)) ||
            (t.deviceSerial && t.deviceSerial.toLowerCase().includes(searchLower))
        );
    }

    if (lastTicketId) {
        const lastDocSnap = await db.collection('repair_tickets').doc(lastTicketId).get();
        if (lastDocSnap.exists) {
            query = query.startAfter(lastDocSnap);
        }
    }

    const snapshot = await query.limit(20).get();
    return snapshot.docs.map(doc => doc.data());
}

async function getRepairTicket({ db, ticketId }) {
    if (!ticketId) throw new Error("Thiếu mã phiếu.");
    
    const doc = await db.collection('repair_tickets').doc(ticketId).get();
    if (!doc.exists) {
        throw new Error(`Không tìm thấy phiếu có mã: ${ticketId}`);
    }
    
    return doc.data();
}

async function updateRepairTicket({ db, ticketId, action, data, userEmail, userName, userRoles }) {
    const ticketRef = db.collection('repair_tickets').doc(ticketId);
    const ticketSnap = await ticketRef.get();
    
    if (!ticketSnap.exists) throw new Error("Phiếu không tồn tại");
    
    const currentTicket = ticketSnap.data();
    
    const isFinished = currentTicket.currentStatus === 'Hoàn tất' || currentTicket.currentStatus === 'Đã trả máy';
    
    if (isFinished && !userRoles.admin) {
        if (action === 'TECH_CHECK' || action === 'SALE_QUOTE') {
            throw new Error("Phiếu đã hoàn tất. Không thể chỉnh sửa thông tin cũ.");
        }
    }

    if (action === 'SALE_QUOTE') {
        if (!userRoles.admin && !userRoles.sale) {
            throw new Error("Chỉ Phòng Kinh Doanh mới có quyền cập nhật báo giá.");
        }
    }

    let updateData = {};
    let logAction = '';
    let logDetails = '';
    
    if (action === 'TECH_CHECK') {
        updateData = {
            currentStatus: 'Chờ báo giá',
            techCheck: {
                technicianName: userName,
                technicianEmail: userEmail,
                checkDate: new Date().toISOString(),
                cause: data.cause,
                solution: data.solution,
                components: data.components,
                photos: data.photos || []
            }
        };
        logAction = 'Kỹ thuật kiểm tra';
        logDetails = `Kết luận: ${data.cause}`;
    }
    
    else if (action === 'SALE_QUOTE') {
        updateData = {
            currentStatus: 'Chờ khách xác nhận',
            quotation: {
                saleName: userName,
                saleEmail: userEmail,
                quoteDate: new Date().toISOString(),
                
                items: data.items || [],
                totalPrice: Number(data.totalPrice) || 0,
                photos: data.photos || [],
                
                warranty: data.warranty,
                notes: data.notes,
                type: data.quoteType || 'INTERNAL',
                externalInfo: data.externalInfo || null
            }
        };
        logAction = 'Sale báo giá';
        const formattedPrice = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(updateData.quotation.totalPrice);
        logDetails = `Báo giá: ${formattedPrice} (${(data.items || []).length} hạng mục)`;
    }
    
    else if (action === 'ASSIGN_WORK') {
        if (!userRoles.admin && !userRoles.inventory_manager) {
             throw new Error("Bạn không có quyền thực hiện thao tác này.");
        }

        const step = data.step;
        const technician = data.technician;

        if (!step || !technician || !technician.email) {
            throw new Error("Thiếu thông tin bước hoặc kỹ thuật viên được giao.");
        }

        const assignmentData = {
            name: technician.name,
            email: technician.email,
            avatarUrl: technician.avatarUrl || '',
            assignedBy: userName,
            assignedAt: new Date().toISOString()
        };

        if (step === 'CHECK') {
            updateData.assignedTechCheck = assignmentData;
            logAction = 'Phân công kiểm tra';
            logDetails = `Giao việc cho KTV: ${technician.name}`;
        } else if (step === 'REPAIR') {
            updateData.assignedRepair = assignmentData;
            logAction = 'Phân công sửa chữa';
            logDetails = `Giao việc cho KTV: ${technician.name}`;
        } else {
            throw new Error(`Bước phân công không hợp lệ: ${step}`);
        }
    }

    else if (action === 'CUSTOMER_CONFIRM') {
        const isAgreed = data.isAgreed; 
        const techSolution = currentTicket.techCheck ? currentTicket.techCheck.solution : '';
        const isUnrepairable = techSolution === 'Không sửa được' || techSolution === 'Trả máy (Không sửa được)';
        
        const isExternal = currentTicket.quotation && currentTicket.quotation.type === 'EXTERNAL';

        if (isAgreed && !isUnrepairable) {
            
            let autoAssignData = {};
            if (currentTicket.assignedTechCheck) {
                autoAssignData = {
                    assignedRepair: {
                        name: currentTicket.assignedTechCheck.name,
                        email: currentTicket.assignedTechCheck.email,
                        assignedBy: 'System (Auto)',
                        assignedAt: new Date().toISOString()
                    }
                };
            }

            updateData = {
                currentStatus: isExternal ? 'Đang sửa ngoài' : 'Đang sửa',
                customerConfirm: {
                    date: new Date().toISOString(),
                    result: 'Đồng ý sửa',
                    note: data.note
                },
                ...autoAssignData
            };
            
            logAction = 'Khách xác nhận';
            logDetails = 'Khách ĐỒNG Ý sửa chữa. Hệ thống tự động chuyển giao cho KTV kiểm tra.';
        } else {
            let resultText = !isAgreed ? 'Không sửa (Từ chối báo giá)' : 'Đồng ý nhận lại máy (Không sửa được)';
            let workText = !isAgreed ? 'Khách từ chối sửa. Trả nguyên trạng.' : 'Kỹ thuật không sửa được. Trả nguyên trạng.';

            if (isExternal) {
                updateData = {
                    currentStatus: 'Đang sửa ngoài',
                    customerConfirm: {
                        date: new Date().toISOString(),
                        result: resultText,
                        note: data.note
                    }
                };
                logDetails = `${resultText}. Cần nhận máy về từ đơn vị ngoài.`;
            } else {
                updateData = {
                    currentStatus: 'Chờ trả máy',
                    customerConfirm: {
                        date: new Date().toISOString(),
                        result: resultText,
                        note: data.note
                    },
                    repair: {
                        technicianName: userName,
                        completionDate: new Date().toISOString(),
                        workDescription: workText,
                        warranty: "Không",
                        photos: []
                    }
                };
                logDetails = `${resultText}. Chuyển sang chờ trả máy.`;
            }
            logAction = 'Khách xác nhận';
        }
    }
    else if (action === 'EXTERNAL_ACTION') {
        const subType = data.subType;

        if (subType === 'SEND') {
            updateData = {
                currentStatus: 'Đang sửa ngoài', 
                externalLogistics: {
                    sentDate: new Date().toISOString(),
                    sentBy: userName,
                    unitName: data.unitName,
                    note: data.note,
                    sentPhotos: data.photos || []
                }
            };
            logAction = 'Gửi sửa ngoài';
            logDetails = `Đã gửi cho: ${data.unitName}`;
        } 
        else if (subType === 'RECEIVE_PASS') {
            const prevLogistics = currentTicket.externalLogistics || {};
            
            const confirm = currentTicket.customerConfirm;
            const isDeclined = confirm && (confirm.result.includes('Không sửa') || confirm.result.includes('Từ chối'));
            
            let workDesc = "";
            let warrantyVal = "";
            let qcResultVal = "Đạt";
            let logActionTxt = "Nhận máy & QC Đạt";
            let logDetailTxt = "Đã nhận về. KTV kiểm tra hoạt động tốt.";

            if (isDeclined) {
                workDesc = "Trả máy không sửa (Đã nhận về từ đơn vị ngoài). Tình trạng: " + data.note;
                warrantyVal = "Không";
                qcResultVal = "Trả về (Không sửa)";
                logActionTxt = "Nhận máy về (Khách hủy)";
                logDetailTxt = "Đã nhận máy về kho. Tình trạng: " + data.note;
            } else {
                workDesc = "Sửa chữa/Bảo hành bởi đối tác. Đã nhận về và QC: " + data.note;
                warrantyVal = data.warranty || "Theo báo giá";
            }

            updateData = {
                currentStatus: 'Chờ trả máy',
                externalLogistics: {
                    ...prevLogistics,
                    receivedDate: new Date().toISOString(),
                    receivedBy: userName,
                    qcResult: qcResultVal,
                    qcNote: data.note,
                    qcPhotos: data.photos || []
                },
                repair: {
                    technicianName: (prevLogistics.unitName || "Đơn vị ngoài") + " (Sửa ngoài)",
                    completionDate: new Date().toISOString(),
                    workDescription: workDesc,
                    warranty: warrantyVal,
                    photos: [] 
                }
            };
            logAction = logActionTxt;
            logDetails = logDetailTxt;
        }
    }
    else if (action === 'ORDER_PARTS') {
        updateData = {
            currentStatus: 'Chờ đặt hàng',
            partOrder: {
                orderBy: userName,
                orderDate: new Date().toISOString(),
                note: data.note
            }
        };
        logAction = 'Đặt linh kiện';
        logDetails = `Yêu cầu đặt hàng. Note: ${data.note}`;
    }
    else if (action === 'PARTS_ARRIVED') {
        updateData = {
            currentStatus: 'Đã có hàng',
            partOrder: {
                ...currentTicket.partOrder,
                arriveDate: new Date().toISOString(),
                arriveBy: userName
            }
        };
        logAction = 'Linh kiện đã về';
        logDetails = 'Đã có hàng. KTV có thể tiến hành sửa.';
    }
    else if (action === 'REPAIR_COMPLETE') {
        updateData = {
            currentStatus: 'Chờ trả máy',
            repair: {
                technicianName: userName,
                technicianEmail: userEmail,
                completionDate: new Date().toISOString(),
                workDescription: data.workDescription,
                warranty: data.warranty,
                photos: data.photos || []
            }
        };
        logAction = 'Hoàn tất sửa chữa';
        logDetails = `Nội dung: ${data.workDescription}. BH: ${data.warranty}`;
    }
    else if (action === 'RETURN_DEVICE') {
        updateData = {
            currentStatus: 'Hoàn tất',
            payment: {
                staffName: userName,
                staffEmail: userEmail,
                date: new Date().toISOString(),
                totalAmount: Number(data.totalAmount) || 0,
                method: data.method,
                ticketNumber: data.ticketNumber,
                note: data.note,
                photos: data.photos || []
            }
        };
        
        const moneyFormatted = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(updateData.payment.totalAmount);
        logAction = 'Trả máy & Thu tiền';
        logDetails = `Thu: ${moneyFormatted}. Sổ: ${data.ticketNumber}. HT: ${data.method}`;
    }
    else if (action === 'MANAGER_ASSIGN') {
        const step = data.step;
        const assignee = data.assignee;
        
        if (step === 'CHECK') {
            updateData = {
                currentStatus: 'Đang kiểm tra',
                assignedTechCheck: {
                    name: assignee.name,
                    email: assignee.email,
                    assignedBy: userName,
                    assignedAt: new Date().toISOString()
                }
            };
            logAction = 'Giao việc Kiểm tra';
            logDetails = `${userName} giao cho ${assignee.name}`;
        } 
        else if (step === 'REPAIR') {
            updateData = {
                currentStatus: 'Đang sửa',
                assignedRepair: {
                    name: assignee.name,
                    email: assignee.email,
                    assignedBy: userName,
                    assignedAt: new Date().toISOString()
                }
            };
            logAction = 'Giao việc Sửa chữa';
            logDetails = `${userName} giao cho ${assignee.name}`;
        }
    }

    if (Object.keys(updateData).length > 0) {
        await ticketRef.update(updateData);
        
        await db.collection('repair_logs').add({
            ticketId: ticketId,
            timestamp: new Date().toISOString(),
            user: userName,
            action: logAction,
            details: logDetails
        });
    }

    return { ok: true };
}

async function uploadInventoryBatch({ db, items }) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error("Không có dữ liệu vật tư để xử lý.");
    }

    const batch = db.batch();
    let count = 0;

    items.forEach((item, index) => {
        if (item && item.code) {
            const sanitizedCode = item.code.toString().toUpperCase().replace(/\//g, '-');
            const docRef = db.collection('inventory').doc(sanitizedCode);
            
            const itemData = {
                code: sanitizedCode,
                name: item.name,
                unit: item.unit || '',
                quantity: item.quantity,
                value: item.value,
                unitPrice: item.unitPrice,
                itemGroup: item.itemGroup || '', 
                lastUpdated: new Date().toISOString()
            };

            if (index === 0) {
            }

            batch.set(docRef, itemData, { merge: true });
            count++;
        }
    });

    if (count === 0) {
        throw new Error("Dữ liệu vật tư không hợp lệ (thiếu 'code').");
    }

    await batch.commit();

    return { ok: true, message: `Đã cập nhật thành công ${count} vật tư.` };
}

async function getInventoryFromFirestore({ db }) {
    const inventorySnapshot = await db.collection('inventory').orderBy('code').get();

    if (inventorySnapshot.empty) {
        return [];
    }

    const itemList = [];
    inventorySnapshot.forEach(doc => {
        const data = doc.data();
        itemList.push({
            code: data.code,
            name: data.name,
            unit: data.unit,
            quantity: data.quantity,
            value: data.value,
            unitPrice: data.unitPrice
        });
    });

    return itemList;
}

async function createInventoryItem({ db, newItem }) {
    const { code, name, unit, group, unitPrice } = newItem;

    if (!code || !name) {
        throw new Error("Mã vật tư và Tên vật tư là bắt buộc.");
    }

    const sanitizedCode = code.toString().toUpperCase().replace(/\//g, '-');
    const docRef = db.collection('inventory').doc(sanitizedCode);

    const doc = await docRef.get();
    if (doc.exists) {
        throw new Error(`Mã vật tư '${sanitizedCode}' đã tồn tại.`);
    }

    const itemData = {
        code: sanitizedCode,
        name: name,
        unit: unit || '',
        itemGroup: group || '',
        quantity: 0,
        value: 0,
        unitPrice: Number(unitPrice) || 0,
        lastUpdated: new Date().toISOString()
    };

    await docRef.set(itemData);

    return { ok: true, message: `Đã tạo vật tư '${sanitizedCode} - ${name}' thành công.` };
}

async function updateAuditItem({ db, auditId, itemCode, quantity, user }) {
    if (!auditId || !itemCode || quantity === undefined) {
        throw new Error("Thiếu thông tin auditId, itemCode hoặc quantity.");
    }

    const auditRef = db.collection('audit_sessions').doc(auditId);
    
    const sessionDoc = await auditRef.get();
    if (!sessionDoc.exists) {
        throw new Error(`Phiên kiểm kê '${auditId}' không tồn tại.`);
    }
    if (sessionDoc.data().status !== 'in_progress') {
        throw new Error(`Phiên kiểm kê đang ở trạng thái '${sessionDoc.data().status}', không thể cập nhật.`);
    }

    const itemRef = auditRef.collection('items').doc(itemCode);

    await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);

        if (!itemDoc.exists) {
            transaction.set(itemRef, {
                code: itemCode,
                quantity: Number(quantity),
                scannedBy: {
                    [user.uid]: {
                        email: user.email,
                        quantity: Number(quantity)
                    }
                }
            });
        } else {
            const newQuantity = (itemDoc.data().quantity || 0) + Number(quantity);
            const scannedByUpdate = {
                [`scannedBy.${user.uid}.email`]: user.email,
                [`scannedBy.${user.uid}.quantity`]: admin.firestore.FieldValue.increment(Number(quantity))
            };
            
            transaction.update(itemRef, {
                quantity: newQuantity,
                ...scannedByUpdate
            });
        }
    });

    return { ok: true, message: `Updated item ${itemCode} in audit ${auditId}` };
}

async function finishAuditSession({ db, auditId, user }) {
    if (!auditId) {
        throw new Error("Thiếu auditId.");
    }

    const auditRef = db.collection('audit_sessions').doc(auditId);
    const auditSnapshot = await auditRef.get();

    if (!auditSnapshot.exists) {
        throw new Error("Phiên kiểm kho không tồn tại.");
    }

    const auditData = auditSnapshot.data();
    if (auditData.status === 'finished') {
        throw new Error("Phiên kiểm kho đã kết thúc.");
    }

    const itemsRef = auditRef.collection('items');
    const itemsSnapshot = await itemsRef.get();

    const adjustments = [];
    itemsSnapshot.forEach(doc => {
        const item = doc.data();
        adjustments.push({
            code: item.code,
            name: item.name || item.code,
            auditedQuantity: item.quantity,
        });
    });

    const inventoryRef = db.collection('inventory');
    const batch = db.batch();

    const finalAdjustments = [];

    for (const adj of adjustments) {
        const itemInventoryRef = inventoryRef.doc(adj.code);
        const itemInventorySnapshot = await itemInventoryRef.get();
        const currentQuantity = itemInventorySnapshot.exists ? (itemInventorySnapshot.data().quantity || 0) : 0;
        
        const diff = adj.auditedQuantity - currentQuantity;

        finalAdjustments.push({
            code: adj.code,
            name: adj.name,
            auditedQuantity: adj.auditedQuantity,
            currentSystemQuantity: currentQuantity,
            difference: diff
        });
    }

    batch.update(auditRef, {
        status: 'finished',
        finishedAt: new Date().toISOString(),
        finishedBy: user.email,
        finalAuditedItems: finalAdjustments
    });

    await batch.commit();

    return { ok: true, message: `Phiên kiểm kho ${auditId} đã kết thúc. Kết quả được lưu chờ xử lý nghiệp vụ.` };
}

async function cleanupBadTickets({ db }) {
    const usageTicketsRef = db.collection('usage_tickets');
    const snapshot = await usageTicketsRef.get();

    if (snapshot.empty) {
        return { ok: true, message: "Không có dữ liệu nào trong usage_tickets để kiểm tra." };
    }

    const batchArray = [db.batch()];
    let operationCounter = 0;
    let batchIndex = 0;
    let deletedCount = 0;
    const validDateRegex = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

    snapshot.forEach(doc => {
        const date = doc.data().date;

        if (date && !validDateRegex.test(date)) {
            batchArray[batchIndex].delete(doc.ref);
            operationCounter++;
            deletedCount++;

            if (operationCounter >= 499) {
                batchArray.push(db.batch());
                batchIndex++;
                operationCounter = 0;
            }
        }
    });

    if (deletedCount === 0) {
        return { ok: true, message: "Không tìm thấy dữ liệu lỗi nào để xóa." };
    }

    await Promise.all(batchArray.map(batch => batch.commit()));

    return { ok: true, message: `Dọn dẹp thành công! Đã xóa ${deletedCount} mục dữ liệu lỗi.` };
}

async function resetAuditSession({ db, auditId }) {
    if (!auditId) {
        throw new Error("Thiếu auditId.");
    }

    const itemsRef = db.collection('audit_sessions').doc(auditId).collection('items');
    const itemsSnapshot = await itemsRef.get();

    if (itemsSnapshot.empty) {
        return { ok: true, message: "Phiên kiểm kho đã trống." };
    }

    const batch = db.batch();
    itemsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    await batch.commit();

    return { ok: true, message: `Đã xóa toàn bộ ${itemsSnapshot.size} vật tư khỏi phiên kiểm kho ${auditId}.` };
}

async function getHistoryTransactions({ db, filters = {}, page = 1, limit = 50 }) {
    let query = db.collection('history_transactions');

    if (filters.email) {
        query = query.where('email', '==', filters.email);
    }
    if (filters.type) {
        query = query.where('type', '==', filters.type);
    }

    // Firestore requires the first orderBy to match the field in an inequality filter
    query = query.orderBy('timestamp', 'desc');

    if (filters.startDate) {
        // Assuming startDate is ISO string or Firestore Timestamp
        query = query.where('timestamp', '>=', filters.startDate);
    }
    if (filters.endDate) {
        query = query.where('timestamp', '<=', filters.endDate);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
        return { transactions: [], total: 0 };
    }

    let allItems = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.items && data.items.length > 0) {
            data.items.forEach((item, index) => {
                allItems.push({
                    txId: doc.id,
                    timestamp: data.timestamp,
                    date: data.date,
                    email: data.email,
                    type: data.type,
                    note: data.note,
                    status: data.status,
                    code: item.code,
                    name: item.name,
                    unit: item.unit,
                    quantity: item.quantity,
                    // Use index for a unique ID within the transaction
                    itemId: `${doc.id}_${index}` 
                });
            });
        } else {
             allItems.push({
                txId: doc.id,
                timestamp: data.timestamp,
                date: data.date,
                email: data.email,
                type: data.type,
                note: data.note,
                status: data.status,
                code: '',
                name: 'Giao dịch chỉ có ghi chú',
                quantity: 0,
                itemId: `${doc.id}_NOTE`
             });
        }
    });

    if (filters.item) {
        const itemSearch = filters.item.toLowerCase();
        allItems = allItems.filter(item => 
            (item.code && item.code.toLowerCase().includes(itemSearch)) || 
            (item.name && item.name.toLowerCase().includes(itemSearch))
        );
    }
    if (filters.search) {
        const noteSearch = filters.search.toLowerCase();
        allItems = allItems.filter(item => item.note && item.note.toLowerCase().includes(noteSearch));
    }
    
    const total = allItems.length;
    const paginatedItems = allItems.slice((page - 1) * limit, page * limit);
    
    return { transactions: paginatedItems, total };
}

async function updateEntireTransaction({ db, txId, updatedItems }) {
    if (!txId || !updatedItems) {
        throw new Error('Thiếu ID giao dịch hoặc danh sách vật tư cập nhật.');
    }

    const txRef = db.collection('history_transactions').doc(txId);
    
    const txDoc = await txRef.get();
    if (!txDoc.exists) {
        throw new Error('Giao dịch không tồn tại.');
    }

    await txRef.update({ 
        items: updatedItems,
        lastModified: new Date().toISOString()
    });
    
    return { ok: true, message: 'Cập nhật giao dịch thành công.' };
}


async function deleteEntireTransaction({ db, txId }) {
    if (!txId) {
        throw new Error('Thiếu ID giao dịch.');
    }
    
    const txRef = db.collection('history_transactions').doc(txId);
    await txRef.delete();

    return { ok: true, message: 'Đã xóa giao dịch.' };
}

async function getReconciliationTickets({ db, month }) {
    // NOTE: This is inefficient as it fetches all documents.
    // This is a workaround because the date format 'DD/MM/YYYY' is not suitable for range queries in Firestore.
    // A future improvement would be to store dates in 'YYYY-MM-DD' format or as a timestamp.
    
    const snapshot = await db.collection('usage_tickets').get();
    if (snapshot.empty) {
        return [];
    }
    
    const ticketsMap = new Map();
    
    const shouldFilterByMonth = month && /^\d{4}-\d{2}$/.test(month);
    let monthToMatch, yearToMatch;
    if (shouldFilterByMonth) {
        monthToMatch = month.substring(5, 7);
        yearToMatch = month.substring(0, 4);
    }

    // Filter in JavaScript
    snapshot.forEach(doc => {
        const data = doc.data();

        if (shouldFilterByMonth) {
            const dateStr = data.date || '';
            const parts = dateStr.split('/');
            
            let docMonth = '';
            let docYear = '';
            if (parts.length === 3) {
                docMonth = parts[1];
                docYear = parts[2];
            }
            // Apply filter
            if (docMonth !== monthToMatch || docYear !== yearToMatch) {
                return; // Skip this document if it doesn't match the month
            }
        }

        // Grouping logic
        const ticketId = data.ticket;
        if (!ticketsMap.has(ticketId)) {
            ticketsMap.set(ticketId, {
                ticket: ticketId, date: data.date, email: data.email,
                status: data.status, items: []
            });
        }
        ticketsMap.get(ticketId).items.push({
            docId: doc.id, itemCode: data.itemCode, itemName: data.itemName,
            quantity: data.quantity, note: data.note, itemGroup: data.itemGroup
        });
    });
    
    const sortedTickets = Array.from(ticketsMap.values()).sort((a, b) => {
        const dateAStr = a.date || ''; 
        const dateBStr = b.date || ''; 
        const dateA = dateAStr.split('/').reverse().join('');
        const dateB = dateBStr.split('/').reverse().join('');
        return dateB.localeCompare(dateA);
    });

    return sortedTickets;
}

async function addReconciliationItem({ db, itemData }) {
    if (!itemData || !itemData.ticket || !itemData.itemCode) {
        throw new Error('Thiếu thông tin ticket hoặc vật tư.');
    }

    const dateStr = itemData.date || new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});
    let monthYear = '';
    if (dateStr && dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            monthYear = `${parts[2]}-${parts[1]}`;
        }
    }

    const docRef = await db.collection('usage_tickets').add({
        date: dateStr,
        monthYear: monthYear,
        email: itemData.email || '',
        itemCode: itemData.itemCode,
        itemName: itemData.itemName || '',
        itemGroup: itemData.itemGroup || '',
        note: itemData.note || '',
        quantity: Number(itemData.quantity) || 1,
        status: itemData.status || 'Chưa đối chiếu',
        ticket: itemData.ticket,
    });
    return { ok: true, docId: docRef.id };
}

async function updateReconciliationItem({ db, docId, newQuantity }) {
    if (!docId) {
        throw new Error('Thiếu ID của mục vật tư.');
    }
    const docRef = db.collection('usage_tickets').doc(docId);
    await docRef.update({
        quantity: Number(newQuantity)
    });
    return { ok: true };
}

async function deleteReconciliationTicket({ db, ticketId }) {
    if (!ticketId) {
        throw new Error('Thiếu ID của sổ.');
    }
    const snapshot = await db.collection('usage_tickets').where('ticket', '==', ticketId).get();
    if (snapshot.empty) {
        return { ok: true, message: 'Không tìm thấy vật tư nào để xóa.' };
    }
    const batch = db.batch();
    snapshot.forEach(doc => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return { ok: true, deletedCount: snapshot.size };
}

async function deleteReconciliationItem({ db, docId }) {
    if (!docId) {
        throw new Error('Thiếu ID của mục vật tư.');
    }
    await db.collection('usage_tickets').doc(docId).delete();
    return { ok: true };
}

async function suggestMaterialsWithAI({ db, description }) {
    // 1. Lấy API Key
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY chưa được thiết lập trong environment variables.');
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    // Sử dụng model gemini-2.0-flash (bản mới nhất của Google)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // 2. Xây dựng prompt để AI tự do gợi ý dựa trên kiến thức chuyên gia
    const prompt = `
        Bạn là một chuyên gia kỹ thuật máy tính, máy in và thiết bị văn phòng chuyên nghiệp. 
        Dựa vào mô tả công việc/lỗi dưới đây, hãy gợi ý những vật tư, linh kiện cần thiết nhất để kỹ thuật viên chuẩn bị trước khi đi sửa chữa.

        Mô tả công việc: "${description}"

        YÊU CẦU:
        1. Gợi ý 2-5 vật tư/linh kiện liên quan trực tiếp đến việc xử lý lỗi trên.
        2. Chỉ trả về một chuỗi văn bản duy nhất, các mục phân cách bằng dấu phẩy.
        3. Định dạng mỗi mục: "Số_lượng TÊN_VẬT_TƯ".
        Ví dụ: "1 Bộ nguồn máy tính, 1 RAM 8GB DDR4, 1 Keo tản nhiệt"
        4. Không giải thích, không chào hỏi, không có ký tự đặc biệt khác.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        
        // Làm sạch chuỗi kết quả (bỏ các ký tự lạ nếu có)
        return { suggestion: text };
    } catch (error) {
        console.error("Lỗi gọi Gemini AI:", error);
        throw new Error("Không thể tạo gợi ý từ AI: " + error.message);
    }
}

module.exports = {
    suggestMaterialsWithAI,
    getTechnicianDashboardData,
    getTechnicians,
    getItemList,
    submitTransaction,
    getBorrowHistory,
    getTicketRanges,
    saveTicketRanges,
    submitErrorReport,
    processExcelData, 
    saveExcelData, 
    verifyAndRegisterUser,
    rejectReturnNote,
    getReturnHistory,
    rejectBorrowNote,
    getPendingCounts,
    managerTransferItems,
    getSpeechAudio,
    getGlobalInventoryOverview,
    getPendingBorrowNotesForTech,
    getSelfPendingBorrowNotes,
    fixNegativeInventory,
    fixNegativeInventoryBatch,
    updateTechnicianAvatar,
    createRepairTicket,
    getRepairTickets,
    getRepairTicket,
    updateRepairTicket,
    uploadInventoryBatch,
    getInventoryFromFirestore,
    createInventoryItem,
    updateAuditItem,
    finishAuditSession,
    resetAuditSession,
    cleanupBadTickets,
    getAllPendingNotes,
    getPendingReturnNotesForTech,
    getReconciliationTickets,
    addReconciliationItem,
    updateReconciliationItem,
    deleteReconciliationTicket,
    deleteReconciliationItem,
    getHistoryTransactions,
    updateEntireTransaction,
    deleteEntireTransaction,
};
