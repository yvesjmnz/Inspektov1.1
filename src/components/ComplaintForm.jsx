import { useState, useRef } from 'react';
import { submitComplaint, getBusinesses, uploadImage } from '../lib/complaints';
import './ComplaintForm.css';

export default function ComplaintForm({ verifiedEmail }) {
  const [formData, setFormData] = useState({
    business_name: '',
    business_address: '',
    complaint_description: '',
    reporter_email: verifiedEmail || '',
    tags: [],
  });

  const [businesses, setBusinesses] = useState([]);
  const [showBusinessList, setShowBusinessList] = useState(false);
  const [images, setImages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const imageInputRef = useRef(null);
  const documentInputRef = useRef(null);

  const handleBusinessSearch = async (query) => {
    setSearchQuery(query);
    if (query.length > 2) {
      try {
        const results = await getBusinesses(query);
        setBusinesses(results);
        setShowBusinessList(true);
      } catch (err) {
        setError(err.message);
      }
    } else {
      setBusinesses([]);
      setShowBusinessList(false);
    }
  };

  const selectBusiness = (business) => {
    setFormData(prev => ({
      ...prev,
      business_name: business.business_name,
      business_address: business.business_address,
    }));
    setShowBusinessList(false);
    setSearchQuery('');
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    setLoading(true);
    setError(null);

    try {
      const uploadedImages = await Promise.all(
        files.map(file => uploadImage(file))
      );
      setImages(prev => [...prev, ...uploadedImages]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    setLoading(true);
    setError(null);

    try {
      const uploadedDocs = await Promise.all(
        files.map(file => uploadImage(file))
      );
      setDocuments(prev => [...prev, ...uploadedDocs]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const removeDocument = (index) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const complaintPayload = {
        business_name: formData.business_name,
        business_address: formData.business_address,
        complaint_description: formData.complaint_description,
        reporter_email: formData.reporter_email,
        image_urls: images,
        document_urls: documents,
        tags: formData.tags,
        status: 'Submitted',
        email_verified: !!verifiedEmail,
      };

      await submitComplaint(complaintPayload);
      setSuccess(true);
      setFormData({
        business_name: '',
        business_address: '',
        complaint_description: '',
        reporter_email: verifiedEmail || '',
        tags: [],
      });
      setImages([]);
      setDocuments([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="complaint-form-container">
        <div className="success-message">
          <div className="success-icon">✓</div>
          <h2>Complaint Submitted Successfully</h2>
          <p>Thank you for your report. We will review it and take appropriate action.</p>
          <button
            onClick={() => setSuccess(false)}
            className="btn btn-primary"
          >
            Submit Another Complaint
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="complaint-form-container">
      <div className="complaint-form-card">
        <h1>Submit a Complaint</h1>
        <p>Please provide detailed information about the business violation.</p>

        <form onSubmit={handleSubmit} className="complaint-form">
          <div className="form-group">
            <label htmlFor="business_search">Business Name</label>
            <input
              id="business_search"
              type="text"
              value={searchQuery}
              onChange={(e) => handleBusinessSearch(e.target.value)}
              placeholder="Search for a business..."
              className="form-input"
            />
            {showBusinessList && businesses.length > 0 && (
              <div className="business-list">
                {businesses.map((business) => (
                  <div
                    key={business.business_pk}
                    className="business-item"
                    onClick={() => selectBusiness(business)}
                  >
                    <div className="business-name">{business.business_name}</div>
                    <div className="business-address">{business.business_address}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="business_address">Business Address</label>
            <input
              id="business_address"
              type="text"
              value={formData.business_address}
              onChange={(e) => setFormData(prev => ({ ...prev, business_address: e.target.value }))}
              placeholder="Full business address"
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="complaint_description">Complaint Description</label>
            <textarea
              id="complaint_description"
              value={formData.complaint_description}
              onChange={(e) => setFormData(prev => ({ ...prev, complaint_description: e.target.value }))}
              placeholder="Describe the violation in detail..."
              className="form-textarea"
              rows="6"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="reporter_email">Your Email</label>
            <input
              id="reporter_email"
              type="email"
              value={formData.reporter_email}
              onChange={(e) => setFormData(prev => ({ ...prev, reporter_email: e.target.value }))}
              className="form-input"
              required
              disabled={!!verifiedEmail}
            />
          </div>

          <div className="form-group">
            <label>Upload Images</label>
            <div className="file-upload">
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                disabled={loading}
                className="file-input"
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={loading}
                className="btn btn-secondary"
              >
                Choose Images
              </button>
            </div>
            {images.length > 0 && (
              <div className="file-list">
                {images.map((image, index) => (
                  <div key={index} className="file-item">
                    <span>{image.split('/').pop()}</span>
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="btn-remove"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Upload Documents</label>
            <div className="file-upload">
              <input
                ref={documentInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt"
                onChange={handleDocumentUpload}
                disabled={loading}
                className="file-input"
              />
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                disabled={loading}
                className="btn btn-secondary"
              >
                Choose Documents
              </button>
            </div>
            {documents.length > 0 && (
              <div className="file-list">
                {documents.map((doc, index) => (
                  <div key={index} className="file-item">
                    <span>{doc.split('/').pop()}</span>
                    <button
                      type="button"
                      onClick={() => removeDocument(index)}
                      className="btn-remove"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary btn-large"
          >
            {loading ? 'Submitting...' : 'Submit Complaint'}
          </button>
        </form>
      </div>
    </div>
  );
}
