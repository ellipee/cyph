import {Injectable} from '@angular/core';
import {config} from '../config';
import {SecretBox} from '../crypto/potassium/secret-box';
import {eventManager} from '../event-manager';
import {Transfer} from '../files/transfer';
import {events, rpcEvents, users} from '../session/enums';
import {Message} from '../session/message';
import {util} from '../util';
import {AnalyticsService} from './analytics.service';
import {ChatService} from './chat.service';
import {ConfigService} from './config.service';
import {PotassiumService} from './crypto/potassium.service';
import {DatabaseService} from './database.service';
import {DialogService} from './dialog.service';
import {FileService} from './file.service';
import {SessionService} from './session.service';
import {StringsService} from './strings.service';


/**
 * Manages file transfers within a chat. Files are transmitted using Firebase Storage.
 * For encryption, native crypto is preferred when available for performance reasons,
 * but libsodium in a separate thread is used as a fallback.
 */
@Injectable()
export class FileTransferService {
	/** @ignore */
	private resolveSecretBox: (secretBox: SecretBox) => void;

	/** @ignore */
	private readonly secretBox: Promise<SecretBox>	=
		/* tslint:disable-next-line:promise-must-complete */
		new Promise<SecretBox>(resolve => {
			this.resolveSecretBox	= resolve;
		})
	;

	/** In-progress file transfers. */
	public readonly transfers: Set<Transfer>	= new Set<Transfer>();

	/** @ignore */
	private addImage (transfer: Transfer, plaintext: Uint8Array) : void {
		this.chatService.addMessage(
			`![](${this.fileService.toDataURI(plaintext, transfer.fileType)})` +
				`\n\n#### ${transfer.name}`
			,
			transfer.author,
			transfer.timestamp,
			undefined,
			transfer.imageSelfDestructTimeout
		);
	}

	/** @ignore */
	private async encryptFile (plaintext: Uint8Array) : Promise<{
		cyphertext: Uint8Array;
		key: Uint8Array;
	}> {
		try {
			const key: Uint8Array	= this.potassiumService.randomBytes(
				await (await this.secretBox).keyBytes
			);

			return {
				cyphertext: await (await this.secretBox).seal(plaintext, key),
				key
			};
		}
		catch (_) {
			return {
				cyphertext: new Uint8Array(0),
				key: new Uint8Array(0)
			};
		}
	}

	/** @ignore */
	private async receiveTransfer (transfer: Transfer) : Promise<void> {
		transfer.isOutgoing			= false;
		transfer.percentComplete	= 0;

		transfer.answer	= await this.uiConfirm(transfer, true);

		if (transfer.answer && transfer.image) {
			transfer.timestamp	= util.timestamp();
		}

		this.sessionService.send(new Message(
			rpcEvents.files,
			transfer
		));

		if (transfer.answer) {
			this.transfers.add(transfer);

			/* Arbitrarily assume ~500 Kb/s for progress bar estimation */
			(async () => {
				while (transfer.percentComplete < 85) {
					await util.sleep(1000);

					transfer.percentComplete +=
						util.random(100000, 25000) / transfer.size * 100
					;
				}
			})();

			const cyphertext: Uint8Array|undefined	= await util.requestBytes({
				retries: 5,
				url: transfer.url
			}).catch(
				() => undefined
			);

			(await this.databaseService.getStorageRef(transfer.url)).delete();

			const plaintext: Uint8Array|undefined	=
				cyphertext ?
					await (await this.secretBox).open(
						cyphertext,
						transfer.key
					).catch(
						() => undefined
					) :
					undefined
			;

			transfer.percentComplete	= 100;
			this.potassiumService.clearMemory(transfer.key);
			this.uiSave(transfer, plaintext);
			await util.sleep(1000);
			this.transfers.delete(transfer);
		}
		else {
			this.uiRejected(transfer);
			(await this.databaseService.getStorageRef(transfer.url)).delete();
		}
	}

	/** @ignore */
	private uiCompleted (transfer: Transfer, plaintext: Uint8Array) : void {
		if (transfer.answer && transfer.image) {
			this.addImage(transfer, plaintext);
		}
		else {
			const message: string	= transfer.answer ?
				this.stringsService.outgoingFileSaved :
				this.stringsService.outgoingFileRejected
			;

			this.chatService.addMessage(
				`${message} ${transfer.name}`,
				users.app
			);
		}
	}

	/** @ignore */
	private async uiConfirm (transfer: Transfer, isSave: boolean) : Promise<boolean> {
		const title	=
			`${this.stringsService.incomingFile} ${transfer.name} ` +
			`(${util.readableByteLength(transfer.size)})`
		;

		return (
				!isSave &&
				transfer.size < this.configService.filesConfig.approvalLimit
			) ||
			(isSave && transfer.image) ||
			await this.dialogService.confirm({
				title,
				cancel: isSave ?
					this.stringsService.discard :
					this.stringsService.reject
				,
				content: isSave ?
					this.stringsService.incomingFileSave :
					this.stringsService.incomingFileDownload
				,
				ok: isSave ?
					this.stringsService.save :
					this.stringsService.accept
			})
		;
	}

	/** @ignore */
	private uiRejected (transfer: Transfer) : void {
		this.chatService.addMessage(
			`${this.stringsService.incomingFileRejected} ${transfer.name}`,
			users.app,
			undefined,
			false
		);
	}

	/** @ignore */
	private uiSave (transfer: Transfer, plaintext?: Uint8Array) : void {
		if (!plaintext) {
			this.chatService.addMessage(
				`${this.stringsService.incomingFileSaveError} ${transfer.name}`,
				users.app,
				undefined,
				false
			);
		}
		else if (transfer.image) {
			this.addImage(transfer, plaintext);
		}
		else {
			util.saveFile(plaintext, transfer.name);
		}
	}

	/** @ignore */
	private uiStarted (transfer: Transfer) : void {
		if (transfer.image) {
			return;
		}

		const message: string	=
			transfer.author === users.me ?
				this.stringsService.fileTransferInitMe :
				this.stringsService.fileTransferInitFriend
		;

		this.chatService.addMessage(`${message} ${transfer.name}`, users.app);
	}

	/** @ignore */
	private async uiTooLarge () : Promise<void> {
		return this.dialogService.alert({
			content: this.stringsService.fileTooLarge,
			ok: this.stringsService.ok,
			title: this.stringsService.oopsTitle
		});
	}

	/**
	 * Sends file.
	 * @param file
	 * @param image If true, file is processed as an image
	 * (compressed and displayed in the message list).
	 * @param imageSelfDestructTimeout
	 */
	public async send (
		file: File,
		image: boolean = this.fileService.isImage(file),
		imageSelfDestructTimeout?: number
	) : Promise<void> {
		const plaintext	= await this.fileService.getBytes(file, image);

		if (plaintext.length > config.filesConfig.maxSize) {
			this.uiTooLarge();

			this.analyticsService.sendEvent({
				eventAction: 'toolarge',
				eventCategory: 'file',
				eventValue: 1,
				hitType: 'event'
			});

			return;
		}

		let uploadTask: firebase.storage.UploadTask;

		const o	= await this.encryptFile(plaintext);

		const transfer: Transfer	= new Transfer(
			file.name,
			file.type,
			image,
			imageSelfDestructTimeout,
			o.cyphertext.length,
			o.key
		);

		this.transfers.add(transfer);

		this.analyticsService.sendEvent({
			eventAction: 'send',
			eventCategory: 'file',
			eventValue: 1,
			hitType: 'event'
		});

		this.uiStarted(transfer);

		eventManager.one<Transfer>(`transfer-${transfer.id}`).then(incomingTransfer => {
			transfer.answer		= incomingTransfer.answer;
			transfer.timestamp	= incomingTransfer.timestamp;

			this.uiCompleted(transfer, plaintext);

			if (!transfer.answer) {
				this.transfers.delete(transfer);

				if (uploadTask) {
					uploadTask.cancel();
				}
			}
		});

		this.sessionService.send(new Message(
			rpcEvents.files,
			transfer
		));

		let complete	= false;
		while (!complete) {
			try {
				const path: string	= 'ephemeral/' + util.generateGuid();

				uploadTask	= (await this.databaseService.getStorageRef(path)).put(
					new Blob([o.cyphertext])
				);

				complete	= await new Promise<boolean>(resolve => uploadTask.on(
					'state_changed',
					(snapshot: firebase.storage.UploadTaskSnapshot) => {
						transfer.percentComplete	=
							snapshot.bytesTransferred /
							snapshot.totalBytes *
							100
						;
					},
					() => { resolve(transfer.answer === false); },
					() => {
						transfer.url	= uploadTask.snapshot.downloadURL || '';

						this.sessionService.send(new Message(
							rpcEvents.files,
							transfer
						));

						this.transfers.delete(transfer);
						resolve(true);
					}
				));
			}
			catch (_) {}
		}
	}

	constructor (
		/** @ignore */
		private readonly analyticsService: AnalyticsService,

		/** @ignore */
		private readonly chatService: ChatService,

		/** @ignore */
		private readonly configService: ConfigService,

		/** @ignore */
		private readonly databaseService: DatabaseService,

		/** @ignore */
		private readonly dialogService: DialogService,

		/** @ignore */
		private readonly fileService: FileService,

		/** @ignore */
		private readonly potassiumService: PotassiumService,

		/** @ignore */
		private readonly sessionService: SessionService,

		/** @ignore */
		private readonly stringsService: StringsService
	) { (async () => {
		const isNativeCryptoSupported	= await this.potassiumService.isNativeCryptoSupported();

		this.sessionService.one(events.beginChat).then(() => {
			this.sessionService.send(new Message(rpcEvents.files, {isNativeCryptoSupported}));
		});

		const downloadAnswers	= new Map<string, boolean>();

		this.sessionService.one<{isNativeCryptoSupported: boolean}>(rpcEvents.files).then(o => {
			/* Negotiation on whether or not to use SubtleCrypto */
			this.resolveSecretBox(
				isNativeCryptoSupported && o.isNativeCryptoSupported ?
					new SecretBox(true) :
					this.potassiumService.secretBox
			);

			this.sessionService.on(rpcEvents.files, async (transfer: Transfer) => {
				if (!transfer.id) {
					return;
				}

				/* Outgoing file transfer acceptance or rejection */
				if (transfer.answer === true || transfer.answer === false) {
					eventManager.trigger(`transfer-${transfer.id}`, transfer);
				}
				/* Incoming file transfer */
				else if (transfer.url) {
					while (!downloadAnswers.has(transfer.id)) {
						await util.sleep();
					}
					if (downloadAnswers.get(transfer.id)) {
						downloadAnswers.delete(transfer.id);
						this.receiveTransfer(transfer);
					}
				}
				/* Incoming file transfer request */
				else {
					this.uiStarted(transfer);

					const ok	= await this.uiConfirm(transfer, false);
					downloadAnswers.set(transfer.id, ok);

					if (!ok) {
						this.uiRejected(transfer);
						transfer.answer	= false;
						this.sessionService.send(new Message(rpcEvents.files, transfer));
					}
				}
			});
		});
	})(); }
}
