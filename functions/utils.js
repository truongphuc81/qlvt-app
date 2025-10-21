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
function getEmailByTicketNumber(ticket, rangesMap) {
    try {
        var s = (ticket == null) ? '' : ('' + ticket).trim();
        if (!s) return '';
        var m = s.match(/\d+/);
        if (!m) return '';
        var num = parseInt(m[0], 10);
        if (!isFinite(num)) return '';

        var ranges = rangesMap || [];
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            if (num >= r.start && num <= r.end) return r.email;
        }
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