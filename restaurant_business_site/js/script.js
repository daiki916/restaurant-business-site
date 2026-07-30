// 飲食店メニュー表作成・ウェブマーケティング副業サイト
// メインJavaScriptファイル

document.addEventListener('DOMContentLoaded', function() {
    // ハンバーガーメニューの制御
    const hamburger = document.querySelector('.hamburger');
    const mobileNav = document.querySelector('.mobile-nav');
    const overlay = document.querySelector('.overlay');
    const mobileNavClose = document.querySelector('.mobile-nav-close');
    
    // ハンバーガーメニュークリック時の処理
    hamburger.addEventListener('click', function() {
        mobileNav.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // スクロール防止
    });
    
    // 閉じるボタンクリック時の処理
    mobileNavClose.addEventListener('click', function() {
        mobileNav.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = ''; // スクロール再開
    });
    
    // オーバーレイクリック時の処理
    overlay.addEventListener('click', function() {
        mobileNav.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = ''; // スクロール再開
    });
    
    // ウィンドウリサイズ時の処理（モバイルナビゲーションの制御）
    window.addEventListener('resize', function() {
        if (window.innerWidth > 767 && mobileNav.classList.contains('active')) {
            mobileNav.classList.remove('active');
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
    });
    
    // スクロール時のヘッダー制御
    const header = document.querySelector('.header');
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', function() {
        let scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        // スクロール方向に応じてヘッダーの表示/非表示を制御
        if (scrollTop > lastScrollTop && scrollTop > 100) {
            // 下にスクロール
            header.style.transform = 'translateY(-100%)';
        } else {
            // 上にスクロール
            header.style.transform = 'translateY(0)';
        }
        
        lastScrollTop = scrollTop;
    });
    
    // スムーススクロール
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            // モーダルを開くリンクはスクロール対象外
            if (this.classList.contains('portfolio-modal-open')) return;

            e.preventDefault();

            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (!targetElement) return;
            
            const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
            const offset = 80; // ヘッダーの高さなどのオフセット
            
            window.scrollTo({
                top: targetPosition - offset,
                behavior: 'smooth'
            });
            
            // モバイルナビゲーションが開いている場合は閉じる
            if (mobileNav.classList.contains('active')) {
                mobileNav.classList.remove('active');
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });
    
    // フォームバリデーション（お問い合わせページ用）
    // バリデーションを通過した場合はそのまま送信する（送信先は form の action 属性）
    const contactForm = document.querySelector('#contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            // 簡易的なバリデーション
            let isValid = true;
            const requiredFields = contactForm.querySelectorAll('[required]');

            requiredFields.forEach(field => {
                if (field.type === 'checkbox' ? !field.checked : !field.value.trim()) {
                    isValid = false;
                    field.classList.add('error');
                } else {
                    field.classList.remove('error');
                }
            });

            // メールアドレスのバリデーション
            const emailField = contactForm.querySelector('input[type="email"]');
            if (emailField && emailField.value.trim()) {
                const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailPattern.test(emailField.value.trim())) {
                    isValid = false;
                    emailField.classList.add('error');
                }
            }

            if (!isValid) {
                e.preventDefault();
                alert('入力内容に誤りがあります。必須項目を確認してください。');
            }
            // isValid の場合は preventDefault せず、action に設定された送信先へそのまま送信される
        });
    }

    // FAQアコーディオン
    document.querySelectorAll('.faq-question').forEach(question => {
        question.addEventListener('click', function() {
            this.closest('.faq-item').classList.toggle('active');
        });
    });

    // ポートフォリオモーダルの開閉
    document.querySelectorAll('.portfolio-modal-open').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const modal = document.querySelector(this.getAttribute('href'));
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    });

    document.querySelectorAll('.portfolio-modal').forEach(modal => {
        // ×ボタンで閉じる
        const closeBtn = modal.querySelector('.portfolio-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            });
        }
        // モーダルの外側クリックで閉じる
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    });
    
    // ポートフォリオフィルター（ポートフォリオページ用）
    const portfolioFilters = document.querySelectorAll('.portfolio-filter');
    if (portfolioFilters.length > 0) {
        portfolioFilters.forEach(filter => {
            filter.addEventListener('click', function() {
                // アクティブクラスの切り替え
                portfolioFilters.forEach(f => f.classList.remove('active'));
                this.classList.add('active');
                
                const filterValue = this.getAttribute('data-filter');
                const portfolioItems = document.querySelectorAll('.portfolio-item');
                
                portfolioItems.forEach(item => {
                    if (filterValue === 'all') {
                        item.style.display = 'block';
                    } else if (item.classList.contains(filterValue)) {
                        item.style.display = 'block';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });
    }
    
    // 料金プランの切り替え（料金ページ用）
    const pricingToggles = document.querySelectorAll('.pricing-toggle');
    if (pricingToggles.length > 0) {
        pricingToggles.forEach(toggle => {
            toggle.addEventListener('click', function() {
                // アクティブクラスの切り替え
                pricingToggles.forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                const pricingType = this.getAttribute('data-pricing');
                const pricingTables = document.querySelectorAll('.pricing-table');

                // 親セクション（.pricing-tables）ごと表示を切り替える
                pricingTables.forEach(table => {
                    const section = table.closest('.pricing-tables') || table;
                    if (table.getAttribute('data-pricing') === pricingType) {
                        section.style.display = 'block';
                        table.style.display = 'block';
                    } else {
                        section.style.display = 'none';
                    }
                });
            });
        });
    }
    
    // 画像の遅延読み込み
    if ('IntersectionObserver' in window) {
        const lazyImages = document.querySelectorAll('img[data-src]');
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                    imageObserver.unobserve(img);
                }
            });
        });
        
        lazyImages.forEach(img => {
            imageObserver.observe(img);
        });
    }
});
