import type { UploadedFile } from "../index.ts";
export interface FileUploadProps {
    label?: string;
    /** For example "image/*,application/pdf". Checked before upload; the server checks again. */
    accept?: string;
    maxBytes?: number;
    hint?: string;
    onUploaded?: (file: UploadedFile) => void;
    /** Name of a hidden input that holds the file id, for use inside a plain form. */
    name?: string;
    className?: string;
    /** Ids from a surrounding Field, so the label and error point here. */
    inputId?: string;
    describedBy?: string;
}
/** A drop zone that is also a normal file input, with progress and a link to the stored file. */
export declare function FileUpload({ label, accept, maxBytes, hint, onUploaded, name, className, inputId, describedBy }: FileUploadProps): import("react").JSX.Element;
