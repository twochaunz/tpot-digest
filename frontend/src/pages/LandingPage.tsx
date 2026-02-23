import { useState, type FormEvent } from 'react'
import { useJoinWaitlist } from '../api/waitlist'

export function LandingPage() {
  const [email, setEmail] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const joinWaitlist = useJoinWaitlist()

  const handleLogin = (e: FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setLoggingIn(true)
    const xhr = new XMLHttpRequest()
    xhr.open('GET', '/app', true, username, password)
    xhr.onload = () => {
      if (xhr.status === 200) {
        window.location.href = '/app'
      } else {
        setLoginError('Invalid credentials')
        setLoggingIn(false)
      }
    }
    xhr.onerror = () => {
      setLoginError('Connection failed')
      setLoggingIn(false)
    }
    xhr.send()
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim()) {
      joinWaitlist.mutate(email.trim())
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;500;600;700;800&family=Nunito:wght@400;600;700&display=swap');

        @keyframes steamFloat1 {
          0% { transform: translateY(0) scaleX(1); opacity: 0.6; }
          50% { transform: translateY(-18px) scaleX(1.3); opacity: 0.3; }
          100% { transform: translateY(-36px) scaleX(0.8); opacity: 0; }
        }
        @keyframes steamFloat2 {
          0% { transform: translateY(0) scaleX(1) translateX(0); opacity: 0.5; }
          50% { transform: translateY(-22px) scaleX(1.2) translateX(4px); opacity: 0.25; }
          100% { transform: translateY(-40px) scaleX(0.7) translateX(-2px); opacity: 0; }
        }
        @keyframes steamFloat3 {
          0% { transform: translateY(0) scaleX(1) translateX(0); opacity: 0.4; }
          50% { transform: translateY(-16px) scaleX(1.4) translateX(-5px); opacity: 0.2; }
          100% { transform: translateY(-34px) scaleX(0.6) translateX(3px); opacity: 0; }
        }
        @keyframes gentleBob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 0; transform: scale(0.5) rotate(0deg); }
          50% { opacity: 1; transform: scale(1) rotate(180deg); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes successPop {
          0% { transform: scale(0.8); opacity: 0; }
          60% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }

        .landing-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(170deg, #FFF8F0 0%, #FFF1E3 35%, #FFE8D6 70%, #FDDCBF 100%);
          font-family: 'Nunito', sans-serif;
          position: relative;
          overflow: hidden;
          padding: 40px 20px;
        }

        .landing-page::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(ellipse at 30% 20%, rgba(255,200,150,0.15) 0%, transparent 50%),
                      radial-gradient(ellipse at 70% 80%, rgba(255,180,130,0.1) 0%, transparent 50%);
          pointer-events: none;
        }

        .landing-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .teapot-wrapper {
          animation: gentleBob 4s ease-in-out infinite;
          position: relative;
          cursor: default;
        }
        .teapot-wrapper:hover {
          animation-play-state: paused;
        }
        .teapot-wrapper:hover .teapot-body {
          transform: rotate(-3deg);
          transition: transform 0.3s ease;
        }

        .sparkle {
          position: absolute;
          width: 8px;
          height: 8px;
          animation: sparkle 3s ease-in-out infinite;
        }
        .sparkle:nth-child(1) { top: 10px; right: -15px; animation-delay: 0s; }
        .sparkle:nth-child(2) { top: -5px; left: 20px; animation-delay: 1s; }
        .sparkle:nth-child(3) { top: 30px; left: -20px; animation-delay: 2s; }

        .title {
          font-family: 'Baloo 2', cursive;
          font-size: 68px;
          font-weight: 800;
          color: #6B3A2A;
          letter-spacing: -1px;
          line-height: 1;
          text-shadow: 0 2px 0 rgba(107, 58, 42, 0.1);
          animation: fadeInUp 0.8s ease-out 0.2s both;
          margin-top: 4px;
        }

        .subtitle {
          font-family: 'Nunito', sans-serif;
          font-size: 16px;
          font-weight: 600;
          color: #A07860;
          letter-spacing: 0.5px;
          animation: fadeInUp 0.8s ease-out 0.35s both;
          margin-bottom: 20px;
        }

        .waitlist-form {
          display: flex;
          align-items: center;
          gap: 0;
          animation: fadeInUp 0.8s ease-out 0.5s both;
          background: white;
          border-radius: 50px;
          padding: 5px 5px 5px 24px;
          box-shadow: 0 4px 24px rgba(139, 90, 60, 0.1), 0 1px 3px rgba(139, 90, 60, 0.08);
          border: 2px solid rgba(180, 130, 100, 0.15);
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
          width: 100%;
          max-width: 420px;
        }
        .waitlist-form:focus-within {
          box-shadow: 0 6px 32px rgba(139, 90, 60, 0.18), 0 2px 6px rgba(139, 90, 60, 0.1);
          border-color: rgba(180, 130, 100, 0.3);
        }

        .email-input {
          border: none;
          outline: none;
          background: transparent;
          font-family: 'Nunito', sans-serif;
          font-size: 15px;
          font-weight: 600;
          color: #5C3D2E;
          flex: 1;
          min-width: 0;
          padding: 10px 0;
        }
        .email-input::placeholder {
          color: #C4A48E;
          font-weight: 400;
        }

        .submit-btn {
          border: none;
          background: linear-gradient(135deg, #D4956A 0%, #C47D52 100%);
          color: white;
          font-family: 'Baloo 2', cursive;
          font-size: 16px;
          font-weight: 700;
          padding: 10px 24px;
          border-radius: 50px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(196, 125, 82, 0.3);
          letter-spacing: 0.3px;
        }
        .submit-btn:hover {
          background: linear-gradient(135deg, #C47D52 0%, #B06E45 100%);
          box-shadow: 0 3px 12px rgba(196, 125, 82, 0.4);
          transform: translateY(-1px);
        }
        .submit-btn:active {
          transform: translateY(0);
          box-shadow: 0 1px 4px rgba(196, 125, 82, 0.3);
        }
        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .success-message {
          animation: successPop 0.5s ease-out both;
          font-family: 'Baloo 2', cursive;
          font-size: 20px;
          font-weight: 700;
          color: #6B3A2A;
          text-align: center;
          padding: 8px 0;
        }

        .sign-in-link {
          margin-top: 24px;
          font-family: 'Nunito', sans-serif;
          font-size: 14px;
          font-weight: 600;
          color: #9C8578;
          cursor: pointer;
          border: none;
          background: none;
          padding: 4px 8px;
          transition: color 0.2s ease;
          animation: fadeInUp 0.8s ease-out 0.65s both;
          letter-spacing: 0.3px;
        }
        .sign-in-link:hover {
          color: #6B3A2A;
        }

        .login-form {
          animation: fadeInUp 0.4s ease-out both;
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 320px;
          margin-top: 20px;
        }

        .login-input {
          border: 2px solid rgba(180, 130, 100, 0.2);
          border-radius: 12px;
          padding: 10px 16px;
          font-family: 'Nunito', sans-serif;
          font-size: 14px;
          font-weight: 600;
          color: #5C3D2E;
          background: white;
          outline: none;
          transition: border-color 0.2s ease;
        }
        .login-input::placeholder {
          color: #C4A48E;
          font-weight: 400;
        }
        .login-input:focus {
          border-color: rgba(180, 130, 100, 0.45);
        }

        .login-btn {
          border: none;
          background: linear-gradient(135deg, #D4956A 0%, #C47D52 100%);
          color: white;
          font-family: 'Baloo 2', cursive;
          font-size: 15px;
          font-weight: 700;
          padding: 10px 24px;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(196, 125, 82, 0.3);
        }
        .login-btn:hover {
          background: linear-gradient(135deg, #C47D52 0%, #B06E45 100%);
          transform: translateY(-1px);
        }
        .login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .login-error {
          color: #C47D52;
          font-family: 'Nunito', sans-serif;
          font-size: 13px;
          font-weight: 600;
          text-align: center;
        }

        .login-back {
          font-family: 'Nunito', sans-serif;
          font-size: 13px;
          font-weight: 600;
          color: #9C8578;
          cursor: pointer;
          border: none;
          background: none;
          padding: 2px 8px;
          transition: color 0.2s ease;
        }
        .login-back:hover {
          color: #6B3A2A;
        }

        @media (max-width: 480px) {
          .title { font-size: 52px; }
          .waitlist-form { max-width: 340px; padding: 4px 4px 4px 18px; }
          .submit-btn { padding: 10px 18px; font-size: 15px; }
          .email-input { font-size: 14px; }
        }
      `}</style>

      <div className="landing-page">
        <div className="landing-content">

          {/* Teapot Character */}
          <div className="teapot-wrapper" style={{ animation: 'gentleBob 4s ease-in-out infinite', animationDelay: '0s' }}>
            {/* Sparkles */}
            <svg className="sparkle" viewBox="0 0 10 10" style={{ position: 'absolute', top: 10, right: -18 }}>
              <polygon points="5,0 6,4 10,5 6,6 5,10 4,6 0,5 4,4" fill="#E8C17A" />
            </svg>
            <svg className="sparkle" viewBox="0 0 10 10" style={{ position: 'absolute', top: -8, left: 25, animationDelay: '1s', width: 6, height: 6 }}>
              <polygon points="5,0 6,4 10,5 6,6 5,10 4,6 0,5 4,4" fill="#D4956A" />
            </svg>
            <svg className="sparkle" viewBox="0 0 10 10" style={{ position: 'absolute', top: 35, left: -22, animationDelay: '2s', width: 7, height: 7 }}>
              <polygon points="5,0 6,4 10,5 6,6 5,10 4,6 0,5 4,4" fill="#E8C17A" />
            </svg>

            <svg
              width="180"
              height="170"
              viewBox="0 0 200 190"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="teapot-body"
              style={{ display: 'block', transition: 'transform 0.3s ease' }}
            >
              {/* Steam wisps */}
              <g>
                <path
                  d="M 70 45 Q 68 35, 72 28 Q 76 20, 70 12"
                  stroke="#D4956A"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.5"
                  style={{ animation: 'steamFloat1 2.8s ease-in-out infinite' }}
                />
                <path
                  d="M 82 42 Q 84 30, 78 22 Q 74 14, 80 6"
                  stroke="#D4956A"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.4"
                  style={{ animation: 'steamFloat2 3.2s ease-in-out infinite', animationDelay: '0.5s' }}
                />
                <path
                  d="M 58 48 Q 54 38, 60 30 Q 64 22, 56 16"
                  stroke="#D4956A"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.35"
                  style={{ animation: 'steamFloat3 3.5s ease-in-out infinite', animationDelay: '1s' }}
                />
              </g>

              {/* Lid knob */}
              <ellipse cx="100" cy="52" rx="8" ry="7" fill="#C47D52" />
              <ellipse cx="100" cy="50" rx="6" ry="5" fill="#D4956A" />
              <ellipse cx="98" cy="48" rx="2" ry="1.5" fill="#E8B898" opacity="0.6" />

              {/* Lid */}
              <ellipse cx="100" cy="62" rx="42" ry="10" fill="#C47D52" />
              <ellipse cx="100" cy="60" rx="40" ry="9" fill="#D4956A" />
              <ellipse cx="92" cy="58" rx="16" ry="3" fill="#E8B898" opacity="0.3" />

              {/* Main body */}
              <ellipse cx="100" cy="110" rx="62" ry="52" fill="#C47D52" />
              <ellipse cx="100" cy="108" rx="60" ry="50" fill="#D4956A" />

              {/* Body highlight */}
              <ellipse cx="85" cy="95" rx="30" ry="25" fill="#E8B898" opacity="0.25" />
              <ellipse cx="78" cy="88" rx="15" ry="12" fill="#F0CCAA" opacity="0.2" />

              {/* Spout */}
              <path
                d="M 38 100 Q 15 85, 18 65 Q 20 52, 30 50"
                stroke="#C47D52"
                strokeWidth="14"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 38 98 Q 17 84, 20 66 Q 22 54, 31 52"
                stroke="#D4956A"
                strokeWidth="10"
                strokeLinecap="round"
                fill="none"
              />
              {/* Spout tip highlight */}
              <circle cx="30" cy="52" r="3" fill="#E8B898" opacity="0.4" />

              {/* Handle */}
              <path
                d="M 162 85 Q 190 85, 192 110 Q 194 135, 162 135"
                stroke="#C47D52"
                strokeWidth="14"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 162 87 Q 188 87, 190 110 Q 192 133, 162 133"
                stroke="#D4956A"
                strokeWidth="10"
                strokeLinecap="round"
                fill="none"
              />

              {/* Base/bottom rim */}
              <ellipse cx="100" cy="158" rx="38" ry="8" fill="#B06E45" />
              <ellipse cx="100" cy="156" rx="36" ry="7" fill="#C47D52" />

              {/* Left eye */}
              <ellipse cx="80" cy="105" rx="7" ry="8" fill="#4A2816" />
              <ellipse cx="78" cy="103" rx="3" ry="3.5" fill="white" opacity="0.8" />

              {/* Right eye */}
              <ellipse cx="120" cy="105" rx="7" ry="8" fill="#4A2816" />
              <ellipse cx="118" cy="103" rx="3" ry="3.5" fill="white" opacity="0.8" />

              {/* Left eyebrow */}
              <path d="M 70 93 Q 77 88, 87 92" stroke="#4A2816" strokeWidth="2.5" strokeLinecap="round" fill="none" />

              {/* Right eyebrow */}
              <path d="M 113 92 Q 123 88, 130 93" stroke="#4A2816" strokeWidth="2.5" strokeLinecap="round" fill="none" />

              {/* Left cheek (rosy) */}
              <ellipse cx="65" cy="118" rx="10" ry="7" fill="#E88B8B" opacity="0.35" />

              {/* Right cheek (rosy) */}
              <ellipse cx="135" cy="118" rx="10" ry="7" fill="#E88B8B" opacity="0.35" />

              {/* Mouth - gentle smile */}
              <path
                d="M 90 124 Q 100 134, 110 124"
                stroke="#4A2816"
                strokeWidth="2.5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Little heart decoration on body */}
              <path
                d="M 97 140 Q 97 136, 100 136 Q 103 136, 103 140 Q 103 144, 100 147 Q 97 144, 97 140"
                fill="#E88B8B"
                opacity="0.4"
              />
            </svg>
          </div>

          {/* Title */}
          <h1 className="title">tpot</h1>

          {/* Subtitle */}
          <p className="subtitle">your daily tea blend</p>

          {/* Waitlist form or success message */}
          {joinWaitlist.isSuccess ? (
            <div className="success-message">
              {joinWaitlist.data?.already_registered
                ? "You're already on the list!"
                : "You're on the list! \u2615"}
            </div>
          ) : (
            <form className="waitlist-form" onSubmit={handleSubmit}>
              <input
                type="email"
                className="email-input"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={joinWaitlist.isPending}
              />
              <button
                type="submit"
                className="submit-btn"
                disabled={joinWaitlist.isPending || !email.trim()}
              >
                {joinWaitlist.isPending ? 'brewing...' : 'tea please'}
              </button>
            </form>
          )}

          {/* Error message */}
          {joinWaitlist.isError && (
            <p style={{
              color: '#C47D52',
              fontFamily: "'Nunito', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              marginTop: 8,
              animation: 'fadeInUp 0.3s ease-out both',
            }}>
              Something went wrong. Try again?
            </p>
          )}

          {/* Sign in */}
          {showLogin ? (
            <form className="login-form" onSubmit={handleLogin}>
              <input
                type="text"
                className="login-input"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                disabled={loggingIn}
              />
              <input
                type="password"
                className="login-input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loggingIn}
              />
              {loginError && <p className="login-error">{loginError}</p>}
              <button
                type="submit"
                className="login-btn"
                disabled={loggingIn || !username || !password}
              >
                {loggingIn ? 'signing in...' : 'sign in'}
              </button>
              <button
                type="button"
                className="login-back"
                onClick={() => { setShowLogin(false); setLoginError('') }}
              >
                back
              </button>
            </form>
          ) : (
            <button
              className="sign-in-link"
              onClick={() => setShowLogin(true)}
              type="button"
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </>
  )
}
