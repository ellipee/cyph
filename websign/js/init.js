try {
	if (!self.crypto && self.msCrypto) {
		self.crypto			= self.msCrypto;
	}
	if (!self.crypto.subtle && crypto.webkitSubtle) {
		self.crypto.subtle	= crypto.webkitSubtle;
	}
}
catch (_) {}

var cryptoSupported	= false;
try {
	crypto.getRandomValues(new Uint8Array(1));
	cryptoSupported	= true;
}
catch (_) {}

if (!(
	cryptoSupported &&
	'Promise' in self &&
	'Worker' in self &&
	'history' in self &&
	'pushState' in self.history &&
	'replaceState' in self.history &&
	'MutationObserver' in self &&
	'localStorage' in self
)) {
	location.pathname	= '/unsupportedbrowser';
}
