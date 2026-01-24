import './Footer.css';

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-left">
          <div className="footer-text">
            <p className="powered-by">Powered by</p>
            <p className="bureau-name">Bureau of Permits</p>
          </div>
          <img src="/cropped-bureau.png" alt="Bureau of Permits Logo" className="footer-logo" />
        </div>
        <div className="footer-right">
          <p className="copyright-text">© 2026 City Government of Manila. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
