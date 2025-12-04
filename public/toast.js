// public/toast.js

/**
 * Shows a toast notification using SweetAlert2.
 * @param {string} title The title of the toast.
 * @param {string} icon The icon to display ('success', 'error', 'warning', 'info', 'question').
 */
function showToast(title, icon = 'info') {
    Swal.close(); // Đóng bất kỳ thông báo Swal nào đang mở
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
        }
    });

    Toast.fire({
        icon: icon,
        title: title
    });
}
