/* tslint:disable:max-file-line-count */

import {Headers, Http, Response, ResponseContentType} from '@angular/http';
import {saveAs} from 'file-saver';
import {BehaviorSubject, Observable, Observer} from 'rxjs';
import {config} from './config';
import {potassiumUtil} from './crypto/potassium/potassium-util';
import {env} from './env';
import {IProto} from './iproto';
import {LockFunction} from './lock-function-type';
import {DialogService} from './services/dialog.service';


/**
 * Miscellaneous helper functions used throughout the codes.
 */
export class Util {
	/** @ignore */
	private static readonly dialogService: Promise<DialogService|undefined>	=
		new Promise<DialogService|undefined>(resolve => {
			if (!env.isMainThread) {
				resolve();
			}

			Util.resolveDialogService	= resolve;
		})
	;

	/** @ignore */
	private static readonly http: Promise<Http|undefined>	=
		new Promise<Http|undefined>(resolve => {
			if (!env.isMainThread) {
				resolve();
			}

			Util.resolveHttp	= resolve;
		})
	;

	/** Sets dialogService. */
	public static resolveDialogService: (http: DialogService) => void;

	/** Sets http. */
	public static resolveHttp: (http: Http) => void;


	/** @ignore */
	private readonly timestampData	= {
		last: 0,
		offset: (async () => {
			/* tslint:disable-next-line:ban */
			const start		= Date.now();
			const server	= parseFloat(await this.request({url: env.baseUrl + 'timestamp'}));
			/* tslint:disable-next-line:ban */
			const end		= Date.now();

			if (server > start && server < end) {
				return 0;
			}
			else {
				return server - end;
			}
		})().catch(
			() => 0
		),
		subtime: 0
	};

	/** Performs HTTP request. */
	private baseRequest<T> (
		o: {
			contentType?: string;
			data?: any;
			discardErrors?: boolean;
			method?: string;
			retries?: number;
			url: string;
		},
		responseType: ResponseContentType,
		getResponseData: (res: Response) => Promise<T>
	) : {
		progress: Observable<number>;
		result: Promise<T>;
	} {
		const progress	= new BehaviorSubject(0);

		return {
			progress,
			result: (async () => {
				const http	= await Util.http;
				if (!http) {
					throw new Error('HTTP service not found.');
				}

				const method: string			= o.method || 'GET';
				const retries: number			= o.retries === undefined ? 0 : o.retries;
				let contentType: string			= o.contentType || '';
				let data: any					= o.data;
				let url: string					= o.url;

				if (url.slice(-5) === '.json') {
					contentType	= 'application/json';
				}
				else if (responseType === ResponseContentType.Text) {
					contentType	= 'application/x-www-form-urlencoded';
				}

				if (data && method === 'GET') {
					url		+= '?' + (
						typeof data === 'object' ?
							this.toQueryString(data) :
							(<string> data.toString())
					);

					data	= undefined;
				}
				else if (typeof data === 'object') {
					data	= contentType === 'application/json' ?
						this.stringify(data) :
						this.toQueryString(data)
					;
				}

				let response: T|undefined;
				let error: Error|undefined;
				let statusOk	= false;

				for (let i = 0 ; !statusOk && i <= retries ; ++i) {
					try {
						progress.next(0);

						const req	= http.request(url, {
							body: data,
							headers: contentType ?
								new Headers({'Content-Type': contentType}) :
								undefined
							,
							method,
							responseType
						});

						const res	= await new Promise<Response>((resolve, reject) => {
							let last: Response;

							req.subscribe(
								r => {
									last	= r;
									progress.next(r.bytesLoaded / r.totalBytes * 100);
								},
								reject,
								() => {
									if (last) {
										resolve(last);
									}
									else {
										reject();
									}
								}
							);
						});

						statusOk	= res.ok;
						response	= await getResponseData(res);
					}
					catch (err) {
						error		= err;
						statusOk	= false;
					}
				}

				if (!statusOk || !response) {
					const err	= error || response || new Error('Request failed.');
					progress.error(err);
					throw err;
				}

				progress.next(100);
				progress.complete();
				return response;
			})()
		};
	}

	/** Deserializes bytes to data. */
	public async deserialize<T> (proto: IProto<T>, bytes: Uint8Array) : Promise<T> {
		return proto.decode(bytes);
	}

	/** Sends an email to the Cyph team. "@cyph.com" may be omitted from to. */
	public async email (
		to: string = 'hello',
		subject: string = 'New Cyph Email',
		message: string = '',
		fromEmail?: string,
		fromName: string = 'Mandrill'
	) : Promise<void> {
		await this.request({
			data: {
				key: 'HNz4JExN1MtpKz8uP2RD1Q',
				message: {
					from_email: (fromEmail || 'test@mandrillapp.com').
						replace('@cyph.com', '@mandrillapp.com')
					,
					from_name: fromName,
					subject,
					text: (
						`${message}\n\n\n---\n\n${env.userAgent}\n\n` +
						`${env.language}\n\n${locationData.href}`
					).replace(/\/#.*/g, ''),
					to: [{
						email: to.replace('@cyph.com', '') + '@cyph.com',
						type: 'to'
					}]
				}
			},
			method: 'POST',
			url: 'https://mandrillapp.com/api/1.0/messages/send.json'
		}).catch(
			() => {}
		);
	}

	/**
	 * Wraps an async Observable with a synchronously created one.
	 * @param initialValue If included, will create a BehaviorSubject instead (for caching).
	 */
	public flattenObservablePromise<T> (
		observable:
			Observable<T>|
			Promise<Observable<T>>|
			(() => Observable<T>)|
			(() => Promise<Observable<T>>)
		,
		initialValue?: T
	) : Observable<T> {
		const subscribe	= async (observer: Observer<T>) =>
			(
				await (typeof observable === 'function' ? observable() : observable)
			).subscribe(
				observer
			)
		;

		if (initialValue) {
			const subject	= new BehaviorSubject(initialValue);
			subscribe(subject);
			return subject;
		}
		else {
			return new Observable<T>(observer => { subscribe(observer); });
		}
	}

	/** Gets a value from a map and sets a default value if none had previously been set. */
	public getOrSetDefault<K, V> (map: Map<K, V>, key: K, defaultValue: () => V) : V {
		if (!map.has(key)) {
			map.set(key, defaultValue());
		}

		const value	= map.get(key);

		if (value === undefined) {
			throw new Error("Util.getOrSetDefault doesn't support nullable types.");
		}

		return value;
	}

	/** Async variant of getOrSetDefault. */
	public async getOrSetDefaultAsync<K, V> (
		map: Map<K, V>,
		key: K,
		defaultValue: () => V|Promise<V>
	) : Promise<V> {
		if (!map.has(key)) {
			map.set(key, await defaultValue());
		}

		const value	= map.get(key);

		if (value === undefined) {
			throw new Error("Util.getOrSetDefaultAsync doesn't support nullable types.");
		}

		return value;
	}

	/** Returns a human-readable representation of the time (e.g. "3:37pm"). */
	public getTimeString (timestamp: number) : string {
		const date: Date		= new Date(timestamp);
		const minute: string	= ('0' + date.getMinutes().toString()).slice(-2);
		let hour: number		= date.getHours();
		let ampm				= 'am';

		if (hour >= 12) {
			hour	-= 12;
			ampm	= 'pm';
		}
		if (hour === 0) {
			hour	= 12;
		}

		return `${hour.toString()}:${minute}${ampm}`;
	}

	/** Executes a Promise within a mutual-exclusion lock in FIFO order. */
	public async lock<T> (
		lock: {promise?: Promise<any>; queue?: string[]; reason?: string},
		f: (reason?: string) => Promise<T>,
		reason?: string
	) : Promise<T> {
		if (lock.queue === undefined) {
			lock.queue	= [];
		}

		const queue	= lock.queue;
		const id	= this.uuid();

		queue.push(id);

		while (queue[0] !== id) {
			await lock.promise;
		}

		const lastReason	= lock.reason;
		lock.reason			= reason;

		let releaseLock	= () => {};
		lock.promise	= new Promise(resolve => {
			releaseLock	= resolve;
		});

		try {
			return await f(lastReason);
		}
		finally {
			queue.shift();
			releaseLock();
		}
	}

	/** Creates and returns a lock function that uses Util.lock. */
	public lockFunction () : LockFunction {
		const lock	= {};
		return async <T> (f: (reason?: string) => Promise<T>, reason?: string) =>
			this.lock(lock, f, reason)
		;
	}

	/**
	 * Executes a Promise within a mutual-exclusion lock, but
	 * will give up after first failed attempt to obtain lock.
	 * @returns Whether or not the lock was obtained.
	 */
	public async lockTryOnce (
		lock: {queue?: string[]},
		f: () => Promise<void>
	) : Promise<boolean> {
		if (lock.queue === undefined || lock.queue.length < 1) {
			await this.lock(lock, f);
			return true;
		}
		return false;
	}

	/** @see JSON.parse */
	public parse<T> (text: string) : T {
		/* tslint:disable-next-line:ban */
		return JSON.parse(text, (_, v) =>
			v && v.isUint8Array && typeof v.data === 'string' ?
				potassiumUtil.fromBase64(v.data) :
				v
		);
	}

	/**
	 * Cryptographically secure replacement for Math.random.
	 * @param max Upper bound.
	 * @param min Lower bound (0 by default).
	 * @returns If max is specified, returns integer in range [min, max);
	 * otherwise, returns float in range [0, 1) (like Math.random).
	 */
	public random (max?: number, min: number = 0) : number {
		const randomData: Uint16Array	= new Uint16Array(3);

		crypto.getRandomValues(randomData);

		let randomUint	= 0;
		for (let i = 0 ; i < randomData.length ; ++i) {
			randomUint		+= randomData[i] * Math.pow(2, i * 16);
			randomData[i]	= 0;
		}

		if (max === config.maxSafeUint) {
			return randomUint;
		}

		const randomFloat: number	= randomUint / config.maxSafeUint;

		if (max === undefined) {
			return randomFloat;
		}
		else if (isNaN(max) || max <= 0) {
			throw new Error('Upper bound must be a positive non-zero number.');
		}
		else if (isNaN(min) || min < 0) {
			throw new Error('Lower bound must be a positive number or zero.');
		}
		else if (min >= max) {
			throw new Error('Upper bound must be greater than lower bound.');
		}
		else {
			return Math.floor((randomFloat * (max - min)) + min);
		}
	}

	/**
	 * Converts b into a human-readable representation.
	 * @param b Number of bytes.
	 * @example 32483478 -> "30.97 MB".
	 */
	public readableByteLength (b: number) : string {
		const gb: number	= b / 1.074e+9;
		const mb: number	= b / 1.049e+6;
		const kb: number	= b / 1024;

		const o	=
			gb >= 1 ?
				{n: gb, s: 'G'} :
				mb >= 1 ?
					{n: mb, s: 'M'} :
					kb >= 1 ?
						{n: kb, s: 'K'} :
						{n: b, s: ''}
		;

		return `${o.n.toFixed(2).replace(/\.?0+$/, '')} ${o.s}B`;
	}

	/** Random ID meant optimized for readability by humans. Uses Config.readableIDCharacters. */
	public readableID (length: number = 0) : string {
		let id	= '';
		for (let i = 0 ; i < length ; ++i) {
			id += config.readableIDCharacters[this.random(config.readableIDCharacters.length)];
		}
		return id;
	}

	/** Performs HTTP request. */
	public async request (o: {
		contentType?: string;
		data?: any;
		method?: string;
		retries?: number;
		url: string;
	}) : Promise<string> {
		return (await this.baseRequest(o, ResponseContentType.Text, async res =>
			(await res.text()).trim()
		)).result;
	}

	/** Performs HTTP request. */
	public async requestBytes (o: {
		contentType?: string;
		data?: any;
		method?: string;
		retries?: number;
		url: string;
	}) : Promise<Uint8Array> {
		return this.requestByteStream(o).result;
	}

	/** Performs HTTP request. */
	public requestByteStream (o: {
		contentType?: string;
		data?: any;
		method?: string;
		retries?: number;
		url: string;
	}) : {
		progress: Observable<number>;
		result: Promise<Uint8Array>;
	} {
		return this.baseRequest(o, ResponseContentType.ArrayBuffer, async res =>
			new Uint8Array(await res.arrayBuffer())
		);
	}

	/** Runs f until it returns with no errors. */
	public async retryUntilSuccessful<T> (
		f: () => (T|Promise<T>),
		maxAttempts: number = 10
	) : Promise<T> {
		for (let i = 0 ; true ; ++i) {
			try {
				return await f();
			}
			catch (err) {
				if (i > maxAttempts) {
					throw err;
				}
				else {
					await this.sleep();
				}
			}
		}
	}

	/** Opens the specified URL. */
	public async saveFile (
		content: Uint8Array,
		fileName: string,
		mediaType?: string
	) : Promise<void> {
		const dialogService	= await Util.dialogService;
		if (!dialogService) {
			throw new Error('Dialog service not found.');
		}

		const oldBeforeUnloadMessage	= beforeUnloadMessage;
		beforeUnloadMessage				= undefined;

		const save	= () => {
			saveAs(
				new Blob(
					[content],
					{
						type: mediaType && mediaType.indexOf('/') > 0 ?
							mediaType :
							'application/octet-stream'
					}
				),
				fileName,
				false
			);
		};

		if (!env.isSafari) {
			save();
		}
		else {
			const handler	= () => {
				document.removeEventListener('click', handler);
				save();
			};
			document.addEventListener('click', handler);
			await dialogService.alert({
				content: `${
					this.translate('Saving file')
				} "${fileName}" ${
					this.translate('with the name "unknown", due to a Safari bug')
				}.`,
				title: this.translate('Save File')
			});
		}

		await this.sleep();
		beforeUnloadMessage	= oldBeforeUnloadMessage;
	}

	/** Serializes data value to binary byte array. */
	public async serialize<T> (proto: IProto<T>, data: T) : Promise<Uint8Array> {
		const err	= await proto.verify(data);
		if (err) {
			throw new Error(err);
		}
		const o	= await proto.encode(data);
		return o instanceof Uint8Array ? o : o.finish();
	}

	/** Sleep for the specifed amount of time. */
	public async sleep (ms: number = 250) : Promise<void> {
		/* tslint:disable-next-line:ban */
		return new Promise<void>(resolve => { setTimeout(() => { resolve(); }, ms); });
	}

	/** @see JSON.stringify */
	public stringify<T> (value: T) : string {
		/* tslint:disable-next-line:ban */
		return JSON.stringify(value, (_, v) =>
			v instanceof Uint8Array ?
				{data: potassiumUtil.toBase64(v), isUint8Array: true} :
				v
		);
	}

	/**
	 * Returns current timestamp, with logic to correct for incorrect
	 * local clocks and ensure each output is unique.
	 */
	public async timestamp () : Promise<number> {
		/* tslint:disable-next-line:ban */
		let timestamp: number	= Date.now() + (await this.timestampData.offset);

		if (timestamp === this.timestampData.last) {
			this.timestampData.subtime += this.random() / 100;
			timestamp += this.timestampData.subtime;
		}
		else {
			this.timestampData.last		= timestamp;
			this.timestampData.subtime	= 0;
		}

		return timestamp;
	}

	/**
	 * Serializes o to a query string (cf. jQuery.param).
	 * @param o
	 * @param parent Ignore this (internal use).
	 */
	public toQueryString (o: any, parent?: string) : string {
		return Object.keys(o).
			map((k: string) => {
				const key: string	= parent ? `${parent}[${k}]` : k;

				return typeof o[k] === 'object' ?
					this.toQueryString(o[k], key) :
					`${encodeURIComponent(key)}=${encodeURIComponent(o[k])}`
				;
			}).
			join('&').
			replace(/%20/g, '+')
		;
	}

	/**
	 * Attempts to translate text into the user's language.
	 * @param text
	 * @param defaultValue Falls back to this if no translation exists.
	 */
	public translate (text: string, defaultValue: string = text) : string {
		if (!translations || !translations[env.language] || !translations[env.language][text]) {
			return defaultValue;
		}

		return translations[env.language][text];
	}

	/** Simulates a click on elem. */
	public triggerClick (elem: HTMLElement) : void {
		if (!env.isWeb) {
			/* TODO: HANDLE NATIVE */
			return;
		}

		const e: Event	= document.createEvent('MouseEvents');
		e.initEvent('click', true, false);
		elem.dispatchEvent(e);
	}

	/** Creates a hex string containing the current timestamp and 16 random bytes. */
	public uuid () : string {
		const bytes	= potassiumUtil.concatMemory(
			true,
			/* tslint:disable-next-line:ban */
			new Uint32Array([Date.now()]),
			potassiumUtil.randomBytes(16)
		);
		const hex	= potassiumUtil.toHex(bytes);
		potassiumUtil.clearMemory(bytes);
		return hex;
	}

	/** Waits for iterable value to exist and have at least minLength elements. */
	public async waitForIterable<T> (
		f: () => T&{length: number}|undefined,
		minLength: number = 1
	) : Promise<T> {
		return this.waitForValue<T&{length: number}>(f, value => value.length >= minLength);
	}

	/** Waits until value exists before resolving it in promise. */
	public async waitForValue<T> (
		f: () => T|undefined,
		condition?: (value: T) => boolean
	) : Promise<T> {
		let value: T|undefined	= f();
		while (value === undefined || (condition && !condition(value))) {
			await this.sleep();
			value	= f();
		}
		return value;
	}

	/** Waits until function returns true. */
	public async waitUntilTrue (f: () => boolean) : Promise<void> {
		await this.waitForValue(() => f() || undefined);
	}

	constructor () {}
}

/** @see Util */
export const util	= new Util();
