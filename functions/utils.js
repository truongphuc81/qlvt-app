// functions/utils.js

// File này chứa các hàm helper chuyển đổi từ Apps Script (Utilities.gs và DataProcessing.gs)

// Chuẩn hóa mã vật tư
function normalizeCode(code){ 
    return (code || '').toString().trim().toLowerCase();
}

// Định dạng ngày tháng về DD/MM/YYYY
function fmtDate(d){ 
    // Trong Node.js, chúng ta sử dụng Intl.DateTimeFormat hoặc một thư viện bên thứ ba.
    // Để đơn giản, ta sẽ dùng phương pháp Node.js cơ bản (giả định múi giờ là 'vi-VN'/'Asia/Ho_Chi_Minh')
    try {
        if (!(d instanceof Date)) d = new Date(d);
        // Sử dụng phương thức an toàn để lấy DD, MM, YYYY
        const day = d.getDate().toString().padStart(2, '0');
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (e) {
        return '';
    }
}

// Lấy email từ số sổ (ticket) - logic này sẽ cần gọi Sheets API, nhưng ta sẽ để GCF xử lý
// Vì GCF sẽ cần gọi Sheets API, ta chỉ giữ lại logic tìm kiếm sau khi đọc Ranges
// File: functions/utils.js

function getEmailByTicketNumber(ticket, rangesMap) {
    try {
        var s = (ticket == null) ? '' : ('' + ticket).trim();
        if (!s) return '';
        var m = s.match(/\d+/);
        if (!m) return '';
        var num = parseInt(m[0], 10);
        if (!isFinite(num)) return '';

        var ranges = rangesMap || [];
        console.log(`[DEBUG] Checking ticket number: ${num}`); // <-- LOG 1: Số sổ đang kiểm tra

        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            
            // <-- LOG 2: In ra từng dải số đang so sánh -->
            console.log(`[DEBUG] Comparing with range: Email=${r.email}, Start=${r.start} (Type: ${typeof r.start}), End=${r.end} (Type: ${typeof r.end})`); 
            
            // Kiểm tra kiểu dữ liệu trước khi so sánh
            if (typeof r.start === 'number' && typeof r.end === 'number' && num >= r.start && num <= r.end) {
                console.log(`[DEBUG] Match found! Returning email: ${r.email}`); // <-- LOG 3: Dải số khớp
                return r.email;
            } else if (typeof r.start !== 'number' || typeof r.end !== 'number') {
                 console.warn(`[DEBUG] Invalid types for range: Email=${r.email}, Start=${r.start}, End=${r.end}`); // <-- LOG 4: Cảnh báo kiểu sai
            }
        }
        console.log(`[DEBUG] No matching range found for ticket ${num}.`); // <-- LOG 5: Không tìm thấy
        return '';
    } catch (e) {
        console.error('getEmailByTicketNumber error:', e);
        return '';
    }
}


// Xuất các hàm để module khác có thể sử dụng
module.exports = {
    normalizeCode,
    fmtDate,
    getEmailByTicketNumber
};