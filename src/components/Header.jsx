import './Header.css';

function Header() {
  return (
    <header className="header">
      <div className="header-content">
        <div className="logo-section">
          <img src="/logo.png" alt="Inspekto Logo" className="logo-image" />
          <div className="logo-text">
            <h1 className="logo">Inspekto</h1>
            <p className="tagline">Complaint Management System</p>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
