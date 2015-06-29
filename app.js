$(document).ready(function(){

	$('#textModal').modal('show');
	$("#callBtn").on("click",createOffer);
	$("#joinBtn").on("click",joinSession);
	$("#hangBtn").on("click",closeCall);

});


var servers = {"iceServers" :[{
    url: 'stun:stun.l.google.com:19302'
}]};

var signalData = { "desc":null,"ice":[]};

var peerConnection = new webkitRTCPeerConnection(servers);

var localVideo = document.getElementById("localVideo");
var remoteVideo = document.getElementById("remoteVideo");

var localStream,remoteStream;

getUserMedia = navigator.webkitGetUserMedia.bind(navigator);

console.log(peerConnection);

peerConnection.onaddstream = gotRemoteStream;
peerConnection.onicecandidate = gotIceCandidate;

peerConnection.oniceconnectionstatechange = function (event) {
		console.log("state changed");
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
                break;
            }
        }	


function createOffer(){

	getUserMedia({audio:true, video:true}, function(stream){

		localVideo.src = URL.createObjectURL(stream);
  		localStream = stream;
  		peerConnection.addStream(localStream);
		peerConnection.createOffer(onConnection,handleError);	
		$("#desc").popover('show');
	},
    function(error) {
      console.log("getUserMedia error: ", error);
    });
	
}

function gotRemoteStream(event){

	console.log("Received remote stream");
	remoteVideo.src = URL.createObjectURL(event.stream);

}

function joinSession(){

	console.log("Inside Join Session");
	var sigdata = document.getElementById("desc").value.trim();
	sigdata = JSON.parse(sigdata)
	if(sigdata["desc"] == ""){

		alert("Please enter the offer");
		return;
	}

	

	getUserMedia({audio:true, video:true}, function(stream){

		localVideo.src = URL.createObjectURL(stream);
  		localStream = stream;

  		peerConnection.addStream(localStream);

  		peerConnection.setRemoteDescription(new RTCSessionDescription(sigdata["desc"]),function(){console.log("Success");},handleError);

		peerConnection.createAnswer(sendReply,handleError);

		addIceCandidates(sigdata["ice"]);

		$("#desc").popover("show");
		
	},
    function(error) {
      console.log("getUserMedia error: ", error);
    });

	
}


function completeHandshake(){

	console.log("Inside complete handshake");
	var sigdata = document.getElementById("desc").value.trim();
	sigdata = JSON.parse(sigdata)
	if(sigdata["desc"] == ""){

		alert("Please enter the answer");
		return;
	}

	peerConnection.setRemoteDescription(new RTCSessionDescription(sigdata["desc"]),function(){console.log("Success");},handleError);
	addIceCandidates(sigdata["ice"]);

}

function sendReply(desc){

	peerConnection.setLocalDescription(desc);
	signalData["desc"] = desc;
	console.log(JSON.stringify(desc));

}



function onConnection(desc){

	console.log("Description is "+desc.sdp);
	peerConnection.setLocalDescription(desc);
	signalData["desc"] = desc;
	$("#joinBtn").off("click").on("click",completeHandshake);

}


function gotIceCandidate(event){
	if(event.candidate){
		signalData["ice"].push(event.candidate);
		document.getElementById("desc").value=JSON.stringify(signalData);
	}


}



function addIceCandidates(canArr){


	for(var i in canArr){

		peerConnection.addIceCandidate(new RTCIceCandidate(canArr[i]));

	}

}

function handleError(err){

	console.log("Error occured "+err);
}


function closeCall(){

	peerConnection.close();
	peerConnection=null;
	
	$("#desc").popover('hide');
	$("#desc").val('');
	$("#localVideo").hide();
	$('#textModal').modal('show');
}