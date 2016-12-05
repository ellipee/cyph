import {
	Directive,
	DoCheck,
	ElementRef,
	Inject,
	Injector,
	Input,
	OnChanges,
	OnDestroy,
	OnInit,
	SimpleChanges
} from '@angular/core';
import {UpgradeComponent} from '@angular/upgrade/static';


/**
 * ng2 wrapper for Material1 md-tab.
 */
@Directive({
	/* tslint:disable-next-line:directive-selector */
	selector: 'md2-tab'
})
export class MdTab
	extends UpgradeComponent implements DoCheck, OnChanges, OnInit, OnDestroy {
	/** Component title. */
	public static readonly title: string	= 'md2Tab';

	/** Component configuration. */
	public static readonly config			= {
		bindings: {
			childClass: '@',
			disabled: '<',
			label: '@'
		},
		/* tslint:disable-next-line:max-classes-per-file */
		controller: class {
			/** @ignore */
			public readonly childClass: string;

			/** @ignore */
			public readonly disabled: boolean;

			/** @ignore */
			public readonly label: string;

			constructor () {}
		},
		template: `
			<md-tab
				ng-class='$ctrl.childClass'
				ng-disabled='$ctrl.disabled'
				ng-attr-label='{{$ctrl.label}}'
				ng-transclude
			></md-tab>
		`,
		transclude: true
	};


	/** @ignore */
	@Input() public childClass: string;

	/** @ignore */
	@Input() public disabled: boolean;

	/** @ignore */
	@Input() public label: string;

	/** @ignore */
	public ngDoCheck () : void {
		super.ngDoCheck();
	}

	/** @ignore */
	public ngOnChanges (changes: SimpleChanges) : void {
		super.ngOnChanges(changes);
	}

	/** @ignore */
	public ngOnDestroy () : void {
		super.ngOnDestroy();
	}

	/** @ignore */
	public ngOnInit () : void {
		super.ngOnInit();
	}

	constructor (
		@Inject(ElementRef) elementRef: ElementRef,
		@Inject(Injector) injector: Injector
	) {
		super(MdTab.title, elementRef, injector);
	}
}
