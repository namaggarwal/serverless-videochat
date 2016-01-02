var App = (function(){


	var servers = {"iceServers" :[{
	    url: 'stun:stun.l.google.com:19302'
	}]},
	
	signalData = {"desc":null,"ice":[]},

	peerConnection,

	localVideo = document.getElementById("localVideo"),

	localStream = null,

	remoteVideo = document.getElementById("remoteVideo"),

	txtBox      = $("#desc"),

	getUserMedia = navigator.webkitGetUserMedia.bind(navigator);


	var

	getPeerConnection = function(){

		peerConnection = new webkitRTCPeerConnection(servers);
		peerConnection.onaddstream = gotRemoteStream;
		peerConnection.onicecandidate = gotIceCandidate;
		peerConnection.oniceconnectionstatechange = onConnectionStatusChange;
	},

	getMediaStream = function(callback){

		getUserMedia(
			{	audio:true,
				video:true	
			},function(stream){
				localStream = stream;
				callback(stream);
			},function(error){

		      console.log("getUserMedia error: ", error);

		    });
	},

	joinSession = function(){

		if(peerConnection == null){
			getPeerConnection();
		}

		var sigdata = JSON.parse(txtBox.val().trim());

		if(sigdata["desc"] == ""){

			alert("Please enter the offer");
			return;
		}

		getMediaStream(createAnswer);



	},

	createOffer = function(stream){

		localVideo.src = URL.createObjectURL(stream);
  		peerConnection.addStream(stream);
  		peerConnection.createOffer(onConnection,handleError);	
		txtBox.popover('show');

	},

	initiateOffer = function(){

		if(peerConnection == null){
			getPeerConnection();
		}

		getMediaStream(createOffer);
		
	},

	onConnection = function(desc){

		console.log("Description is "+desc.sdp);
		peerConnection.setLocalDescription(desc);
		signalData["desc"] = desc;

		//Change the event on click of Join Button to Complete Handshake on Initiator Side
		$("#joinBtn").off("click").on("click",completeHandshake);

	},

	createAnswer = function(stream){

		var sigdata = JSON.parse(txtBox.val().trim());

		localVideo.src = URL.createObjectURL(stream);
	  	
	  	peerConnection.addStream(stream);

  		peerConnection.setRemoteDescription(new RTCSessionDescription(sigdata["desc"]),function(){console.log("Success");},handleError);

		peerConnection.createAnswer(sendReply,handleError);

		addIceCandidates(sigdata["ice"]);

		txtBox.popover("show");
	
	},

	completeHandshake = function(){

		console.log("Inside complete handshake");
		var sigdata = document.getElementById("desc").value.trim();
		sigdata = JSON.parse(sigdata)
		if(sigdata["desc"] == ""){

			alert("Please enter the answer");
			return;
		}

		peerConnection.setRemoteDescription(new RTCSessionDescription(sigdata["desc"]),function(){console.log("Success");},handleError);
		addIceCandidates(sigdata["ice"]);

	},

	sendReply = function(desc){

		peerConnection.setLocalDescription(desc);
		signalData["desc"] = desc;
		console.log(JSON.stringify(desc));

	},


	gotIceCandidate = function(event){
		if(event.candidate){
			signalData["ice"].push(event.candidate);
			document.getElementById("desc").value=JSON.stringify(signalData);
		}


	},

	addIceCandidates = function(canArr){


		for(var i in canArr){

			peerConnection.addIceCandidate(new RTCIceCandidate(canArr[i]));

		}

	},

	handleError = function(err){

		console.log("Error occured "+err);
	},


	closeCall = function(){


		peerConnection.close();
		//peerConnection=null;

		txtBox.popover('hide');
		txtBox.val('');
		localVideo.pause();
		remoteVideo.pause();
		localStream = null;
		$(localVideo).hide();
		showModal();
	},

	showModal = function(){

		$("#textModal").modal('show');
	},

	hideModal = function(){

		$("#textModal").modal('hide');

	},


	onConnectionStatusChange = function (event) {

	    switch (peerConnection.iceConnectionState) {
	        case 'checking':
	            console.log('Connecting to peer...');
	            break;
	        case 'connected':
	        case 'completed': // on caller side
	            console.log('Connection established.');
	            $('#textModal').modal('hide');
	            $("#localVideo").show();
	            $("#hangupdiv").show();
	            break;
	        case 'disconnected':
	            console.log('Disconnected.');
	            closeCall();
	            break;
	        case 'failed':
	        	console.log('Failed.');
	            break;
	        case 'closed':
	            console.log('Connection closed.');
	            peerConnection = null;
	            $("#joinBtn").off("click").on("click",joinSession);
	            break;
	    }
	},

	gotRemoteStream = function(event){

		console.log("Received remote stream");
		remoteVideo.src = URL.createObjectURL(event.stream);

	},

	attachEvents = function(){

		$("#callBtn").on("click",initiateOffer);
		$("#joinBtn").on("click",joinSession);
		$("#hangBtn").on("click",closeCall);
		

	},

	init = function(){


		getPeerConnection();
		
		attachEvents();

		showModal();

	}



	return {
		init:init
	};

})();



$(document).ready(function(){


	App.init();
	
});


