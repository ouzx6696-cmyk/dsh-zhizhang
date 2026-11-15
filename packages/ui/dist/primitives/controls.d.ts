import React from "react";
import { type CheckboxProps, type FieldProps, type SegmentedProps, type SelectProps, type TabsProps, type ToggleProps } from "./types.js";
export declare function Checkbox({ label, checked, indeterminate, disabled, description, className, onChange, }: CheckboxProps): React.JSX.Element;
export declare function Toggle({ label, checked, disabled, description, className, onChange, }: ToggleProps): React.JSX.Element;
export declare function Field({ id, label, hint, error, required, className, children, }: FieldProps): React.JSX.Element;
export declare function Select<T extends string = string>({ id, label, options, value, placeholder, disabled, className, onChange, }: SelectProps<T>): React.JSX.Element;
export declare function Segmented<T extends string = string>({ label, options, value, size, className, onChange, }: SegmentedProps<T>): React.JSX.Element;
export declare function Tabs({ id, label, items, value, orientation, className, onChange, }: TabsProps): React.JSX.Element;
//# sourceMappingURL=controls.d.ts.map