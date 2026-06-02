/**
 * Serverless VideoChat Application
 * Pure client-side WebRTC with manual Base64 signaling
 */

const App = (() => {
  // WebRTC configuration - using public Google STUN servers
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  // State variables
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let screenStream = null;
  let iceGatheringTimeout = null;
  let isHost = false;

  // Signal data structure
  let signalData = {
    desc: null,
    ice: []
  };

  // DOM Elements
  const el = {
    statusBar: document.getElementById('status-bar'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    
    setupPanel: document.getElementById('setup-panel'),
    videoInterface: document.getElementById('video-interface'),
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    
    // Tabs & Setup Inputs
    tabHost: document.getElementById('tab-host'),
    tabJoin: document.getElementById('tab-join'),
    screenHost: document.getElementById('screen-host'),
    screenJoin: document.getElementById('screen-join'),
    btnInitiateHost: document.getElementById('btn-initiate-host'),
    joinOfferInput: document.getElementById('join-offer-input'),
    btnSubmitOffer: document.getElementById('btn-submit-offer'),
    
    // Connection Overlay Elements
    connectionOverlay: document.getElementById('connection-overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayDesc: document.getElementById('overlay-desc'),
    overlayGathering: document.getElementById('overlay-gathering'),
    overlayGatheringText: document.getElementById('overlay-gathering-text'),
    overlayProgress: document.getElementById('overlay-progress'),
    overlayKeySection: document.getElementById('overlay-key-section'),
    overlayKeyOutput: document.getElementById('overlay-key-output'),
    btnCopyOverlayKey: document.getElementById('btn-copy-overlay-key'),
    overlayInputSection: document.getElementById('overlay-input-section'),
    overlayAnswerInput: document.getElementById('overlay-answer-input'),
    btnOverlayConnect: document.getElementById('btn-overlay-connect'),
    btnMinimizeOverlay: document.getElementById('btn-minimize-overlay'),
    btnToggleOverlay: document.getElementById('btn-toggle-overlay'),
    
    // Media Controls
    btnToggleMic: document.getElementById('btn-toggle-mic'),
    btnToggleCam: document.getElementById('btn-toggle-cam'),
    btnShareScreen: document.getElementById('btn-share-screen'),
    btnHangup: document.getElementById('btn-hangup'),
    iconMic: document.getElementById('icon-mic'),
    iconMicMute: document.getElementById('icon-mic-mute'),
    iconCam: document.getElementById('icon-cam'),
    iconCamOff: document.getElementById('icon-cam-off'),
    
    // Toast
    toastMsg: document.getElementById('toast-msg'),
    toastText: document.getElementById('toast-text')
  };

  /**
   * Helper: Base64 Encoding and Decoding
   */
  const encodeKey = (data) => {
    try {
      const jsonStr = JSON.stringify(data);
      return btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode('0x' + p1);
      }));
    } catch (e) {
      console.error('Encoding error:', e);
      return '';
    }
  };

  const decodeKey = (base64Str) => {
    try {
      const decodedStr = decodeURIComponent(atob(base64Str).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(decodedStr);
    } catch (e) {
      console.error('Decoding error:', e);
      return null;
    }
  };

  /**
   * Helper: Clipboard Copy
   */
  const copyToClipboard = (text, elementId) => {
    if (!text) return;
    navigator.clipboard.writeText(text)
      .then(() => {
        showToast('Key copied to clipboard!');
        const btn = document.getElementById(elementId);
        if (btn) {
          const originalText = btn.innerHTML;
          btn.innerHTML = '✓ Copied!';
          setTimeout(() => {
            btn.innerHTML = originalText;
          }, 2000);
        }
      })
      .catch((err) => {
        console.error('Clipboard write failed:', err);
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          showToast('Key copied!');
        } catch (err2) {
          showToast('Failed to copy. Please manually select and copy.');
        }
        document.body.removeChild(textarea);
      });
  };

  /**
   * Helper: UI Toast notification
   */
  const showToast = (message) => {
    el.toastText.textContent = message;
    el.toastMsg.classList.add('show');
    setTimeout(() => {
      el.toastMsg.classList.remove('show');
    }, 3000);
  };

  /**
   * Update the UI Connection status indicator
   */
  const updateStatus = (state, customText) => {
    el.statusDot.className = 'status-dot';
    
    switch(state) {
      case 'disconnected':
        el.statusDot.classList.remove('active', 'warning', 'danger');
        el.statusText.textContent = customText || 'Disconnected';
        break;
      case 'gathering':
        el.statusDot.classList.add('warning');
        el.statusText.textContent = customText || 'Gathering routing information...';
        break;
      case 'connecting':
        el.statusDot.classList.add('warning');
        el.statusText.textContent = customText || 'Connecting to peer...';
        break;
      case 'connected':
        el.statusDot.classList.add('active');
        el.statusText.textContent = customText || 'Connected';
        break;
      case 'failed':
        el.statusDot.classList.add('danger');
        el.statusText.textContent = customText || 'Connection failed';
        break;
    }
  };

  /**
   * Request user media (audio + video)
   */
  const getUserMedia = async () => {
    if (localStream) return localStream;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      localStream = stream;
      el.localVideo.srcObject = stream;
      return stream;
    } catch (error) {
      console.error('Camera/Mic permission error:', error);
      alert('Failed to access camera and microphone. Please ensure permissions are granted.');
      throw error;
    }
  };

  /**
   * Create PeerConnection and bind common event listeners
   */
  const createPeerConnection = () => {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // ICE Candidate gathering
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Gathered ICE Candidate:', event.candidate.candidate);
        signalData.ice.push(event.candidate);
        
        // Progressively fill progress bar in overlay
        const progress = Math.min(90, 10 + (signalData.ice.length * 15));
        el.overlayProgress.style.width = `${progress}%`;
      }
    };

    // Tracks handler - Modern substitute for onaddstream
    peerConnection.ontrack = (event) => {
      console.log('Received remote stream track:', event.track.kind);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        el.remoteVideo.srcObject = remoteStream;
      }
      remoteStream.addTrack(event.track);
    };

    // ICE connection state listener
    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      console.log('ICE Connection State changed to:', state);
      
      switch(state) {
        case 'checking':
          updateStatus('connecting', 'Connecting to peer...');
          break;
        case 'connected':
          updateStatus('connected', 'Connected! Enjoy your call.');
          // Fallback: only auto-hide the overlay here if it's the Host (who pasted the key).
          // Otherwise, we wait for DTLS to complete (tracked by onconnectionstatechange).
          if (isHost) {
            el.connectionOverlay.style.display = 'none';
          }
          break;
        case 'disconnected':
          console.warn('Peer disconnected.');
          updateStatus('failed', 'Peer disconnected.');
          closeCall();
          break;
        case 'failed':
          console.error('ICE connection failed.');
          updateStatus('failed', 'Connection failed.');
          alert('WebRTC connection failed. This could be due to firewall/NAT restrictions.');
          closeCall();
          break;
        case 'closed':
          updateStatus('disconnected', 'Call ended.');
          break;
      }
    };

    // Standard connection state listener (ICE + DTLS)
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log('Overall Connection State changed to:', state);
      
      if (state === 'connected') {
        updateStatus('connected', 'Connected! Enjoy your call.');
        el.connectionOverlay.style.display = 'none';
        el.btnShareScreen.disabled = false; // Enable screen sharing on connection established!
      } else if (state === 'failed') {
        updateStatus('failed', 'Connection failed.');
        alert('WebRTC connection failed. This could be due to firewall/NAT restrictions.');
        closeCall();
      } else if (state === 'disconnected') {
        updateStatus('failed', 'Peer disconnected.');
        closeCall();
      }
    };

    // Log signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log('Signaling state changed to:', peerConnection.signalingState);
    };
  };

  /**
   * Wait for ICE gathering to complete before revealing the key
   */
  const waitForIceGathering = () => {
    return new Promise((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState);
          clearTimeout(iceGatheringTimeout);
          resolve();
        }
      };

      peerConnection.addEventListener('icegatheringstatechange', checkState);

      // Timeout fallback: if ICE gathering takes longer than 4.5 seconds, resolve with what we have
      iceGatheringTimeout = setTimeout(() => {
        console.warn('ICE gathering timeout - resolving with gathered candidates');
        peerConnection.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 4500);
    });
  };

  /**
   * Transition UI into Video Interface & show Connection Overlay
   */
  const enterVideoScreen = (title, desc) => {
    el.setupPanel.style.display = 'none';
    el.videoInterface.classList.add('active');
    
    // Initialize connection overlay
    el.overlayTitle.textContent = title;
    el.overlayDesc.textContent = desc;
    el.connectionOverlay.style.display = 'flex';
    el.overlayGathering.style.display = 'flex';
    el.overlayProgress.style.width = '15%';
    el.overlayKeySection.style.display = 'none';
    el.overlayInputSection.style.display = 'none';
  };

  /**
   * Host Flow Action: Initiate Call
   */
  const initiateHostCall = async () => {
    isHost = true;
    enterVideoScreen('Hosting a Call', 'Initializing local stream and discovering media routes...');
    updateStatus('gathering', 'Discovering media routes (ICE)...');

    try {
      const stream = await getUserMedia();
      createPeerConnection();
      
      // Add all local tracks to the connection
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      // Create Offer SDP
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      
      signalData.desc = peerConnection.localDescription;

      // Wait for routing candidates to finish gathering
      await waitForIceGathering();

      // Show completed key screen in overlay
      el.overlayProgress.style.width = '100%';
      setTimeout(() => {
        el.overlayGathering.style.display = 'none';
        el.overlayTitle.textContent = 'Share Connection Key';
        el.overlayDesc.textContent = 'Send your Host Key to your friend, and paste their Answer Key below.';
        
        // Finalize offer data incorporating all ICE candidates
        signalData.desc = peerConnection.localDescription;
        const base64Key = encodeKey(signalData);
        el.overlayKeyOutput.value = base64Key;
        el.overlayKeySection.style.display = 'block';
        el.overlayInputSection.style.display = 'block';
        
        updateStatus('disconnected', 'Waiting for friend to join...');
      }, 300);

    } catch (error) {
      console.error('Host initiation failed:', error);
      closeCall();
    }
  };

  /**
   * Host Flow Action: Finish Handshake
   */
  const completeHandshake = async () => {
    const answerKeyStr = el.overlayAnswerInput.value.trim();
    if (!answerKeyStr) {
      alert('Please paste the answer key sent by your friend.');
      return;
    }

    const answerData = decodeKey(answerKeyStr);
    if (!answerData || !answerData.desc || answerData.desc.type !== 'answer') {
      alert('Invalid Answer Key. Please make sure you copied the correct key from your friend.');
      return;
    }

    try {
      updateStatus('connecting', 'Completing connection handshake...');
      
      // Set Remote Description
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answerData.desc));
      
      // Add candidates if they weren't in the SDP
      if (answerData.ice && Array.isArray(answerData.ice)) {
        for (const candidate of answerData.ice) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('Error adding candidate:', e);
          }
        }
      }
    } catch (error) {
      console.error('Handshake completion failed:', error);
      alert('Failed to connect: ' + error.message);
      closeCall();
    }
  };

  /**
   * Join Flow Action: Submit Offer and Generate Answer
   */
  const submitOfferAndGenerateAnswer = async () => {
    isHost = false;
    const offerKeyStr = el.joinOfferInput.value.trim();
    if (!offerKeyStr) {
      alert('Please paste the host\'s connection key.');
      return;
    }

    const offerData = decodeKey(offerKeyStr);
    if (!offerData || !offerData.desc || offerData.desc.type !== 'offer') {
      alert('Invalid Connection Key. Please request a fresh key from the host.');
      return;
    }

    enterVideoScreen('Joining a Call', 'Setting up remote offer and gathering local media routes...');
    updateStatus('gathering', 'Generating routing routes...');

    try {
      const stream = await getUserMedia();
      createPeerConnection();

      // Add local tracks
      stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
      });

      // Set Remote Description (Host Offer)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData.desc));

      // Import Host ICE Candidates
      if (offerData.ice && Array.isArray(offerData.ice)) {
        for (const candidate of offerData.ice) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('Error adding candidate:', e);
          }
        }
      }

      // Create Answer SDP
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      signalData.desc = peerConnection.localDescription;

      // Wait for local candidates to be gathered
      await waitForIceGathering();

      // Show completed Answer screen in overlay
      el.overlayProgress.style.width = '100%';
      setTimeout(() => {
        el.overlayGathering.style.display = 'none';
        el.overlayTitle.textContent = 'Send Answer Key';
        el.overlayDesc.textContent = 'Copy the Answer Key below, send it back to the host, and wait for them to connect.';

        signalData.desc = peerConnection.localDescription;
        const base64Answer = encodeKey(signalData);
        el.overlayKeyOutput.value = base64Answer;
        el.overlayKeySection.style.display = 'block';

        updateStatus('connecting', 'Waiting for host to complete...');
      }, 300);

    } catch (error) {
      console.error('Join response failed:', error);
      closeCall();
    }
  };

  /**
   * Media Controls: Toggle Microphone
   */
  const toggleMute = () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    if (audioTrack.enabled) {
      el.btnToggleMic.classList.remove('muted');
      el.iconMic.style.display = 'block';
      el.iconMicMute.style.display = 'none';
      showToast('Microphone unmuted');
    } else {
      el.btnToggleMic.classList.add('muted');
      el.iconMic.style.display = 'none';
      el.iconMicMute.style.display = 'block';
      showToast('Microphone muted');
    }
  };

  /**
   * Media Controls: Toggle Video Camera
   */
  const toggleCamera = () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    if (videoTrack.enabled) {
      el.btnToggleCam.classList.remove('muted');
      el.iconCam.style.display = 'block';
      el.iconCamOff.style.display = 'none';
      showToast('Camera enabled');
    } else {
      el.btnToggleCam.classList.add('muted');
      el.iconCam.style.display = 'none';
      el.iconCamOff.style.display = 'block';
      showToast('Camera disabled');
    }
  };

  /**
   * Media Controls: Toggle Screen Sharing
   */
  const toggleScreenShare = async () => {
    if (!peerConnection || peerConnection.iceConnectionState !== 'connected') {
      showToast('Wait until call is connected to share screen');
      return;
    }

    if (screenStream) {
      await stopScreenShare();
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStream = stream;
        
        const screenTrack = stream.getVideoTracks()[0];
        
        // Find the video track sender in peer connection
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack);
        }
        
        // Update local video element with the screen stream preview
        el.localVideo.srcObject = stream;
        
        el.btnToggleCam.disabled = true; // Disable cam toggle during screen share
        el.btnShareScreen.classList.add('active');
        showToast('Screen sharing started');

        // Handle native "Stop Sharing" overlay click in browser
        screenTrack.onended = () => {
          stopScreenShare();
        };

      } catch (err) {
        console.error('Error starting screen share:', err);
        showToast('Screen share cancelled or failed');
      }
    }
  };

  /**
   * Media Controls: Stop Screen Sharing
   */
  const stopScreenShare = async () => {
    if (!screenStream) return;
    
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    
    try {
      const cameraTrack = localStream.getVideoTracks()[0];
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      
      if (videoSender && cameraTrack) {
        await videoSender.replaceTrack(cameraTrack);
      }
      
      // Restore local camera preview
      el.localVideo.srcObject = localStream;
      
      el.btnToggleCam.disabled = false;
      el.btnShareScreen.classList.remove('active');
      showToast('Screen sharing stopped');
    } catch (err) {
      console.error('Error stopping screen share:', err);
    }
  };

  /**
   * End Call & Close peer connection
   */
  const closeCall = () => {
    console.log('Ending call and resetting states...');
    
    // Stop screen share tracks if active
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }

    // Stop local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    // Clear timeout
    if (iceGatheringTimeout) {
      clearTimeout(iceGatheringTimeout);
      iceGatheringTimeout = null;
    }

    // Close RTC connection
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    remoteStream = null;
    signalData = { desc: null, ice: [] };

    // Reset videos
    el.localVideo.srcObject = null;
    el.remoteVideo.srcObject = null;

    // Reset connection status
    updateStatus('disconnected', 'Disconnected');

    // Return to setup panel UI
    el.videoInterface.classList.remove('active');
    el.setupPanel.style.display = 'block';

    resetUI();
    showToast('Call ended');
  };

  /**
   * Reset Form & Steps fields in Wizard Setup Panel
   */
  const resetUI = () => {
    // Reset inputs
    el.joinOfferInput.value = '';
    el.btnSubmitOffer.disabled = true;
    
    // Reset overlay elements
    el.overlayAnswerInput.value = '';
    el.overlayKeyOutput.value = '';
    el.btnOverlayConnect.disabled = true;
    el.connectionOverlay.style.display = 'none';
    el.overlayGathering.style.display = 'none';

    // Media controls state restore
    el.btnToggleMic.classList.remove('muted');
    el.iconMic.style.display = 'block';
    el.iconMicMute.style.display = 'none';
    
    el.btnToggleCam.classList.remove('muted');
    el.btnToggleCam.disabled = false;
    el.iconCam.style.display = 'block';
    el.iconCamOff.style.display = 'none';

    el.btnShareScreen.classList.remove('active');
    el.btnShareScreen.disabled = true; // Disabled initially until call establishes
  };

  /**
   * Bind DOM and interactive actions
   */
  const bindEvents = () => {
    // Tab switching: Host vs Join
    el.tabHost.addEventListener('click', () => {
      el.tabHost.classList.add('active');
      el.tabJoin.classList.remove('active');
      el.tabHost.setAttribute('aria-selected', 'true');
      el.tabJoin.setAttribute('aria-selected', 'false');
      
      el.screenHost.classList.add('active');
      el.screenJoin.classList.remove('active');
      resetUI();
    });

    el.tabJoin.addEventListener('click', () => {
      el.tabJoin.classList.add('active');
      el.tabHost.classList.remove('active');
      el.tabJoin.setAttribute('aria-selected', 'true');
      el.tabHost.setAttribute('aria-selected', 'false');
      
      el.screenJoin.classList.add('active');
      el.screenHost.classList.remove('active');
      resetUI();
    });

    // Form inputs change check (enable/disable action buttons)
    el.overlayAnswerInput.addEventListener('input', () => {
      el.btnOverlayConnect.disabled = el.overlayAnswerInput.value.trim() === '';
    });

    el.joinOfferInput.addEventListener('input', () => {
      el.btnSubmitOffer.disabled = el.joinOfferInput.value.trim() === '';
    });

    // Action buttons execution
    el.btnInitiateHost.addEventListener('click', initiateHostCall);
    el.btnSubmitOffer.addEventListener('click', submitOfferAndGenerateAnswer);
    el.btnOverlayConnect.addEventListener('click', completeHandshake);

    // Copy overlay key
    el.btnCopyOverlayKey.addEventListener('click', () => {
      copyToClipboard(el.overlayKeyOutput.value, 'btn-copy-overlay-key');
    });

    // Minimize and Toggle Connection Overlay
    el.btnMinimizeOverlay.addEventListener('click', () => {
      el.connectionOverlay.style.display = 'none';
    });

    el.btnToggleOverlay.addEventListener('click', () => {
      if (el.connectionOverlay.style.display === 'none') {
        el.connectionOverlay.style.display = 'flex';
      } else {
        el.connectionOverlay.style.display = 'none';
      }
    });

    // Media and Call controls
    el.btnToggleMic.addEventListener('click', toggleMute);
    el.btnToggleCam.addEventListener('click', toggleCamera);
    el.btnShareScreen.addEventListener('click', toggleScreenShare);
    el.btnHangup.addEventListener('click', closeCall);
  };

  /**
   * Public Init
   */
  const init = () => {
    bindEvents();
    resetUI();
    console.log('Serverless VideoChat successfully initialized!');
  };

  return {
    init
  };
})();

// Document Ready bootstrap
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
