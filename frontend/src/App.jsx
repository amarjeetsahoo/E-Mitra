import React, { useState, useEffect, useRef } from 'react';

const API_BASE_URL = 'http://localhost:5000/api';

const locales = {
  hindi: {
    subtitle: "दिल्ली श्रमिक साथी",
    placeholder: "अपनी समस्या यहाँ लिखें...",
    micTitle: "माइक दबाकर बोलें",
    sendTitle: "भेजें",
    logout: "Log out",
    officeCardTitle: "📍 आपका नजदीकी श्रम कार्यालय (Nearest Office):",
    districtLabel: "जिला:",
    officeLabel: "कार्यालय:",
    addressLabel: "पता:",
    helplineLabel: "हेल्पलाइन:",
    mapsLinkText: "🗺️ दिशा-निर्देश देखें (Open Google Maps)",
    authTitleRegister: "श्रमिक पंजीकरण (Register)",
    authTitleLogin: "श्रमिक लॉगिन (Login)",
    emailLabel: "ईमेल (Email Address)",
    passwordLabel: "पासवर्ड (Password)",
    authBtnRegister: "पंजीकरण करें (Register)",
    authBtnLogin: "प्रवेश करें (Login)",
    demoLogin: "✨ Demo Quick Login (डेमो लॉगिन)",
    toggleRegister: "नया खाता बनाएं (Create Account)",
    toggleLogin: "पहले से खाता है? लॉगिन करें"
  },
  english: {
    subtitle: "Delhi Labour Companion",
    placeholder: "Type your query here...",
    micTitle: "Speak into mic",
    sendTitle: "Send",
    logout: "Log out",
    officeCardTitle: "📍 Your Nearest Labour Office:",
    districtLabel: "District:",
    officeLabel: "Office:",
    addressLabel: "Address:",
    helplineLabel: "Helpline:",
    mapsLinkText: "🗺️ View Directions (Open Google Maps)",
    authTitleRegister: "Labour Registration",
    authTitleLogin: "Labour Login",
    emailLabel: "Email Address",
    passwordLabel: "Password",
    authBtnRegister: "Register",
    authBtnLogin: "Log In",
    demoLogin: "✨ Demo Quick Login",
    toggleRegister: "Create a new account",
    toggleLogin: "Already have an account? Log in"
  }
};

function App() {
  // Auth state
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [email, setEmail] = useState(localStorage.getItem('email') || '');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Chat and Voice state
  const [chatHistory, setChatHistory] = useState([
    {
      sender: 'bot',
      text: 'Welcome to E-Mitra',
      data: {
        hindi: "नमस्ते! मैं ई-मित्र हूँ। मैं दिल्ली में प्रवासी श्रमिकों की मदद के लिए हूँ। आप मुझसे अपने श्रम अधिकारों, न्यूनतम मजदूरी (₹695/दिन से शुरू), ई-श्रम कार्ड या अपने पास के श्रम कार्यालय के बारे में पूछ सकते हैं। कृपया नीचे दिए गए माइक बटन को दबाकर बोलें या टाइप करें।",
        english: "Hello! I am E-Mitra, here to support migrant workers in Delhi. You can ask me about your labour rights, minimum wage scales (starts at ₹695/day), e-Shram cards, or locate your nearest labour office. Please tap the mic below to speak or type your question."
      }
    }
  ]);
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('hindi'); // Speak language 'hindi' or 'english'
  
  // Geolocation state
  const [coords, setCoords] = useState(null);
  const [nearestOffice, setNearestOffice] = useState(null);

  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const abortControllerRef = useRef(null);

  const [audioUrl, setAudioUrl] = useState(null);
  const [recordingTimer, setRecordingTimer] = useState(0);

  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [speakingMessageIdx, setSpeakingMessageIdx] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const MAX_QUERY_LENGTH = 500;

  // Central audio kill-switch — call this anywhere you need silence
  const stopAllAudio = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeakingMessageIdx(null);
  };

  // Sync theme to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isLoading]);

  // Request browser geolocation on mount/login
  useEffect(() => {
    if (token) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoords({
            lat: position.coords.latitude,
            lon: position.coords.longitude
          });
          fetchNearestOffice(position.coords.latitude, position.coords.longitude);
        },
        (err) => {
          console.warn('Geolocation access denied. Falling back to default office.');
          fetchNearestOffice();
        }
      );
    }
  }, [token]);



  // Pre-load voices list for speechSynthesis
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
        };
      }
    }
  }, []);

  const fetchNearestOffice = async (lat = null, lon = null) => {
    try {
      const res = await fetch(`${API_BASE_URL}/route-office`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ lat, lon })
      });
      const data = await res.json();
      if (!data.error) {
        setNearestOffice(data);
      }
    } catch (err) {
      console.error('Failed to fetch nearest office:', err);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = isRegisterMode ? 'register' : 'login';

    try {
      const res = await fetch(`${API_BASE_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (!isRegisterMode) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('email', data.email);
        setToken(data.token);
        setEmail(data.email);
      } else {
        setIsRegisterMode(false);
        setError('Registration successful! Please login.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDemoBypass = () => {
    setLoginEmail('admin@emitra.in');
    setLoginPassword('mitra123');
    setIsRegisterMode(false);
    // Submit login
    setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'admin@emitra.in', password: 'mitra123' })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('email', data.email);
          setToken(data.token);
          setEmail(data.email);
        }
      } catch (err) {
        setError('Demo login failed. Make sure server is running.');
      }
    }, 100);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    setToken('');
    setEmail('');
    setNearestOffice(null);
  };

  const startVoiceListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Your browser does not support Speech Recognition. Please use Chrome or Edge, or type your query.');
      return;
    }

    if (isListening) {
      // Stop listening & recording
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.warn('Failed to stop speech recognition:', e);
        }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.warn('Failed to stop media recorder:', e);
        }
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      setIsListening(false);
      return;
    }

    // Clear old audio before starting new recording
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setRecordingTimer(0);

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = selectedLanguage === 'hindi' ? 'hi-IN' : 'en-US';

      rec.onstart = () => {
        setIsListening(true);
        setError('');
      };

      rec.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        setQuery(transcript);
      };

      rec.onerror = (e) => {
        console.error('Speech recognition error:', e);
        if (e.error === 'not-allowed') {
          setError('Microphone access blocked. Please enable microphone permissions in your browser settings.');
          setIsListening(false);
        }
      };

      rec.onend = () => {
        // Recognition ended (e.g. timeout), check if media recorder is still running and stop it too
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
        }
        setIsListening(false);
      };

      recognitionRef.current = rec;

      // Initialize MediaRecorder
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
            const newUrl = URL.createObjectURL(audioBlob);
            setAudioUrl(newUrl);
            stream.getTracks().forEach(track => track.stop());
          };

          mediaRecorder.start();
          rec.start();

          // Start 2-minute countdown/timer
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = setInterval(() => {
            setRecordingTimer(prev => {
              if (prev >= 119) { // 2 minutes (120 seconds) limit
                if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
                rec.stop();
                clearInterval(timerIntervalRef.current);
                setIsListening(false);
                return 120;
              }
              return prev + 1;
            });
          }, 1000);
        })
        .catch(err => {
          console.error('Failed to get media stream:', err);
          setError('Microphone access denied or unavailable. Please enable permissions.');
          setIsListening(false);
        });

    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setError('Could not start microphone listening. Please try again.');
      setIsListening(false);
    }
  };

  const toggleSpeak = (text, lang, msgIdx) => {
    if ('speechSynthesis' in window) {
      if (speakingMessageIdx === msgIdx) {
        window.speechSynthesis.cancel();
        setSpeakingMessageIdx(null);
      } else {
        window.speechSynthesis.cancel();
        setSpeakingMessageIdx(msgIdx);
        const utterance = new SpeechSynthesisUtterance(text);
        
        const voices = window.speechSynthesis.getVoices();
        if (lang === 'hindi') {
          utterance.lang = 'hi-IN';
          const hiVoice = voices.find(v => v.lang.startsWith('hi') && (v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('kalpana') || v.name.toLowerCase().includes('female')));
          if (hiVoice) utterance.voice = hiVoice;
        } else {
          utterance.lang = 'en-US';
          let enVoice = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('zira'));
          if (!enVoice) {
            enVoice = voices.find(v => 
              v.lang.startsWith('en') && 
              (v.name.toLowerCase().includes('google') || 
               v.name.toLowerCase().includes('natural') || 
               v.name.toLowerCase().includes('aria') || 
               v.name.toLowerCase().includes('hazel') ||
               v.name.toLowerCase().includes('susan'))
            );
          }
          if (enVoice) {
            utterance.voice = enVoice;
          } else {
            const backupEnVoice = voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('david'));
            if (backupEnVoice) utterance.voice = backupEnVoice;
          }
          utterance.rate = 0.95;
          utterance.pitch = 1.02;
        }

        utterance.onend = () => {
          setSpeakingMessageIdx(null);
        };
        utterance.onerror = () => {
          setSpeakingMessageIdx(null);
        };

        window.speechSynthesis.speak(utterance);
      }
    }
  };

  // Delete the last user message and put its text back in the input for editing
  const undoLastMessage = () => {
    setChatHistory(prev => {
      if (prev.length < 2) return prev;  // keep welcome message
      const last = prev[prev.length - 1];
      if (last.sender === 'user') {
        setQuery(last.text);              // restore text for re-editing
        return prev.slice(0, -1);
      }
      return prev;
    });
  };

  const handleSubmit = async (e, forcedQuery = '') => {
    if (e) e.preventDefault();
    const rawQuery = (forcedQuery || query).trim();
    if (!rawQuery || isLoading) return;

    // Input guardrails
    const activeQuery = rawQuery.slice(0, MAX_QUERY_LENGTH);

    // Stop any playing audio immediately
    stopAllAudio();

    // Abort any in-flight request
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    // Stop active recording if user pressed send while mic is live
    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (err) { console.warn(err); }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (err) { console.warn(err); }
      }
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setIsListening(false);
    }

    // Add user query to chat
    setChatHistory(prev => [...prev, { sender: 'user', text: activeQuery }]);
    setQuery('');
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ query: activeQuery }),
        signal: abortControllerRef.current.signal
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error occurred');

      const newBotMsg = { sender: 'bot', text: '', data };
      let botMsgIdx = -1;
      setChatHistory(prev => {
        botMsgIdx = prev.length;
        return [...prev, newBotMsg];
      });
      const speakBody = selectedLanguage === 'hindi' ? data.hindi : data.english;
      setTimeout(() => toggleSpeak(speakBody, selectedLanguage, botMsgIdx), 50);

    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled — no error
      setError('Failed to fetch reply. Check connection.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Header Panel */}
      <header>
        <div className="brand-section">
          <span className="brand-logo">👷</span>
          <div className="brand-title">
            <h1>E-Mitra</h1>
            <p>{locales[selectedLanguage].subtitle}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div className="lang-toggle">
            <button 
              className={`lang-btn ${selectedLanguage === 'hindi' ? 'active' : ''}`}
              onClick={() => { stopAllAudio(); setSelectedLanguage('hindi'); }}
            >
              हिन्दी
            </button>
            <button 
              className={`lang-btn ${selectedLanguage === 'english' ? 'active' : ''}`}
              onClick={() => { stopAllAudio(); setSelectedLanguage('english'); }}
            >
              Eng
            </button>
          </div>

          {token && (
            <button
              className="avatar-btn"
              onClick={() => setProfileOpen(true)}
              title={email}
              aria-label="Open profile menu"
            >
              {email.charAt(0).toUpperCase()}
            </button>
          )}
        </div>
      </header>

      {/* Profile Popup Modal */}
      {profileOpen && (
        <div className="profile-modal-backdrop" onClick={() => setProfileOpen(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-avatar">
              {email.charAt(0).toUpperCase()}
            </div>
            <div className="profile-modal-name">{email.split('@')[0]}</div>
            <div className="profile-modal-email">{email}</div>

            <div className="profile-modal-divider" />

            <div className="profile-modal-row">
              <span className="profile-modal-row-label">
                {theme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}
              </span>
              <button
                className={`appearance-toggle ${theme === 'light' ? 'light-on' : ''}`}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle appearance"
              >
                <span className="appearance-toggle-thumb" />
              </button>
            </div>

            <div className="profile-modal-divider" />

            <button
              className="profile-modal-logout"
              onClick={() => { setProfileOpen(false); handleLogout(); }}
            >
              🚪 {locales[selectedLanguage].logout}
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {!token ? (
        <div className="auth-container">
          {error && <div className="error-banner">{error}</div>}
          <div className="auth-card">
            <h2>{isRegisterMode ? locales[selectedLanguage].authTitleRegister : locales[selectedLanguage].authTitleLogin}</h2>
            <form className="auth-form" onSubmit={handleAuth}>
              <div className="input-group">
                <label>{locales[selectedLanguage].emailLabel}</label>
                <input 
                  type="email" 
                  value={loginEmail} 
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@email.com"
                  required
                />
              </div>
              <div className="input-group">
                <label>{locales[selectedLanguage].passwordLabel}</label>
                <input 
                  type="password" 
                  value={loginPassword} 
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="******"
                  required
                />
              </div>
              <button type="submit" className="auth-btn">
                {isRegisterMode ? locales[selectedLanguage].authBtnRegister : locales[selectedLanguage].authBtnLogin}
              </button>
            </form>
            
            <button className="demo-bypass-btn" onClick={handleDemoBypass}>
              {locales[selectedLanguage].demoLogin}
            </button>

            <p style={{ textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
              <span 
                style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }}
                onClick={() => setIsRegisterMode(!isRegisterMode)}
              >
                {isRegisterMode ? locales[selectedLanguage].toggleLogin : locales[selectedLanguage].toggleRegister}
              </span>
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Chat Window */}
          <div className="chat-window">
            {error && <div className="error-banner">{error}</div>}
            
            {chatHistory.map((msg, idx) => (
              <div key={idx} className={`message ${msg.sender}`}>
                {msg.sender === 'user' ? (
                  <div className="user-bubble">{msg.text}</div>
                ) : (
                  <div className="bot-bubble">
                    <div className="bilingual-panels">
                      {/* Only the active language panel is rendered; the other is preserved in state */}
                      {selectedLanguage === 'hindi' ? (
                        <div className="panel highlighted-panel panel-fade">
                          <div className="panel-header">
                            <span>हिन्दी</span>
                            <button
                              className={`speaker-icon ${speakingMessageIdx === idx ? 'speaking' : ''}`}
                              title={speakingMessageIdx === idx ? 'आवाज़ बंद करें' : 'पढ़कर सुनाएं'}
                              onClick={() => toggleSpeak(msg.data.hindi, 'hindi', idx)}
                            >
                              {speakingMessageIdx === idx ? '⏹️' : '🔊'}
                            </button>
                          </div>
                          <div className="panel-text">{msg.data.hindi}</div>
                        </div>
                      ) : (
                        <div className="panel highlighted-panel panel-fade">
                          <div className="panel-header">
                            <span>English</span>
                            <button
                              className={`speaker-icon ${speakingMessageIdx === idx ? 'speaking' : ''}`}
                              title={speakingMessageIdx === idx ? 'Stop Reading' : 'Read Aloud'}
                              onClick={() => toggleSpeak(msg.data.english, 'english', idx)}
                            >
                              {speakingMessageIdx === idx ? '⏹️' : '🔊'}
                            </button>
                          </div>
                          <div className="panel-text">{msg.data.english}</div>
                        </div>
                      )}
                    </div>


                    {/* Geolocation Nearest Office Card (if queried/logged) */}
                    {idx === chatHistory.length - 1 && nearestOffice && (
                      <div className="office-card">
                        <h4>{locales[selectedLanguage].officeCardTitle}</h4>
                        <p><strong>{locales[selectedLanguage].districtLabel}</strong> {nearestOffice.office_district}</p>
                        <p><strong>{locales[selectedLanguage].officeLabel}</strong> {nearestOffice.title}</p>
                        <p><strong>{locales[selectedLanguage].addressLabel}</strong> {selectedLanguage === 'hindi' ? nearestOffice.office_address_hindi : nearestOffice.office_address_english}</p>
                        <p><strong>{locales[selectedLanguage].helplineLabel}</strong> {nearestOffice.office_helpline}</p>
                        <a 
                          className="office-link"
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nearestOffice.office_maps_query)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {locales[selectedLanguage].mapsLinkText}
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Skeleton Loading state */}
            {isLoading && (
              <div className="message bot">
                <div className="bot-bubble">
                  <div className="skeleton-loader">
                    <div className="skeleton-line" style={{ width: '90%' }}></div>
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line" style={{ width: '60%' }}></div>
                  </div>
                </div>
              </div>
            )}

            {/* Scroll anchor with bottom breathing room so nothing hides behind the input dock */}
            <div ref={chatEndRef} style={{ paddingBottom: '1rem', flexShrink: 0 }} />
          </div>

          {/* Sticky Input Area with Local Audio Preview & Recording Status */}
          <div className="input-area-container">
            {isListening && (
              <div className="recording-status-container">
                <span className="recording-dot"></span>
                <span className="recording-text">
                  {selectedLanguage === 'hindi' ? '🔴 आवाज़ रिकॉर्ड हो रही है...' : '🔴 Recording voice...'} ({Math.floor(recordingTimer / 60)}:{String(recordingTimer % 60).padStart(2, '0')} / 2:00)
                </span>
              </div>
            )}
            {audioUrl && (
              <div className="audio-preview-container">
                <div className="audio-preview-header">
                  <span>{selectedLanguage === 'hindi' ? '🔊 आपका रिकॉर्ड किया गया संदेश:' : '🔊 Your Recorded Voice Message:'}</span>
                  <button 
                    type="button" 
                    className="delete-audio-btn" 
                    onClick={() => {
                      URL.revokeObjectURL(audioUrl);
                      setAudioUrl(null);
                    }}
                  >
                    ❌ {selectedLanguage === 'hindi' ? 'हटाएं' : 'Delete'}
                  </button>
                </div>
                <audio src={audioUrl} controls className="audio-playback-player" />
              </div>
            )}
            <form className="input-dock" onSubmit={(e) => {
              handleSubmit(e);
              if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
                setAudioUrl(null);
              }
            }}>
              <button 
                type="button" 
                className={`voice-mic-btn ${isListening ? 'listening' : ''}`}
                onClick={startVoiceListening}
                title={locales[selectedLanguage].micTitle}
              >
                🎤
              </button>
              <input 
                type="text" 
                className="text-input-field" 
                placeholder={locales[selectedLanguage].placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, MAX_QUERY_LENGTH))}
                maxLength={MAX_QUERY_LENGTH}
              />
              {/* Undo: only show if last message was from user and we're not loading */}
              {!isLoading && chatHistory.length > 1 && chatHistory[chatHistory.length - 1].sender === 'user' && (
                <button type="button" className="undo-btn" onClick={undoLastMessage} title="Edit last message">
                  ✏️
                </button>
              )}
              <button type="submit" className="send-arrow-btn" title={locales[selectedLanguage].sendTitle}>
                ➔
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
