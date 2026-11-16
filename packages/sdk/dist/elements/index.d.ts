declare const Base: typeof HTMLElement;
/**
 * <bakorin-auth-form data-mode="sign-in|sign-up|forgot|reset" data-redirect="/app">
 * wrapping a form rendered by SignInForm.astro and friends.
 */
export declare class BakorinAuthForm extends Base {
    connectedCallback(): void;
}
/**
 * <bakorin-record-form data-entity="tasks" data-id="..."> around RecordForm.astro.
 * Sends every value on create and only changed values on update. Fires
 * bakorin:saved with the record in event.detail.
 */
export declare class BakorinRecordForm extends Base {
    connectedCallback(): void;
}
/** <bakorin-data-table> around DataTable.astro: in place paging, sorting, toggles, delete, and live updates. */
export declare class BakorinDataTable extends Base {
    private collection?;
    private stop;
    connectedCallback(): void;
    disconnectedCallback(): void;
}
/** <bakorin-live-list> around LiveList.astro. */
export declare class BakorinLiveList extends Base {
    private stop;
    connectedCallback(): void;
    disconnectedCallback(): void;
}
/** <bakorin-file-upload> around FileUpload.astro (or a file field in RecordForm.astro). Fires bakorin:uploaded. */
export declare class BakorinFileUpload extends Base {
    connectedCallback(): void;
}
/** Registers the elements. Safe to call more than once. */
export declare function defineBakorinElements(): void;
export {};
