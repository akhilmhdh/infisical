import { useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  Button,
  DialogClose,
  DialogFooter,
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  TextArea
} from "@app/components/v3";

type Props = {
  onCreateFolder?: (folderName: string, description: string | null) => Promise<void>;
  onUpdateFolder?: (
    folderName: string,
    description: string | null,
    changeReason: string,
    oldFolderName?: string,
    oldFolderDescription?: string
  ) => Promise<void>;
  isEdit?: boolean;
  defaultFolderName?: string;
  defaultDescription?: string;
  showDescriptionOverwriteWarning?: boolean;
};

const descriptionOverwriteWarningMessage =
  "Warning: Any changes made here will overwrite any custom edits in individual environment folders.";

const baseFormSchema = z.object({
  name: z
    .string()
    .trim()
    .max(255, "Name cannot exceed 255 characters")
    .regex(/^[a-zA-Z0-9-_]+$/, "Name can only contain letters, numbers, dashes, and underscores"),
  description: z.string().optional(),
  changeReason: z.string().trim().max(256, "Change reason cannot exceed 256 characters")
});

// Editing an existing folder is audited, so the reason is mandatory there. Creation is not audited the
// same way and keeps the field optional.
const getFormSchema = (isEdit: boolean) =>
  isEdit
    ? baseFormSchema.extend({
        changeReason: z
          .string()
          .trim()
          .min(1, "Change reason is required")
          .max(256, "Change reason cannot exceed 256 characters")
      })
    : baseFormSchema;

type TFormData = z.infer<typeof baseFormSchema>;

export const FolderForm = ({
  isEdit,
  defaultFolderName,
  defaultDescription,
  onCreateFolder,
  onUpdateFolder,
  showDescriptionOverwriteWarning = false
}: Props): JSX.Element => {
  const {
    control,
    reset,
    formState: { isSubmitting },
    handleSubmit
  } = useForm<TFormData>({
    resolver: zodResolver(getFormSchema(Boolean(isEdit))),
    defaultValues: {
      name: defaultFolderName,
      description: defaultDescription || "",
      changeReason: ""
    }
  });

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const handleInput = () => {
    const textarea = descriptionRef.current;
    if (textarea) {
      const lines = textarea.value.split("\n");
      const maxDescriptionLines = 10;

      if (lines.length > maxDescriptionLines) {
        textarea.value = lines.slice(0, maxDescriptionLines).join("\n");
      }
    }
  };

  const onSubmit = async ({ name, description, changeReason }: TFormData) => {
    const descriptionShaped = description && description.trim() !== "" ? description : null;

    if (isEdit) {
      await onUpdateFolder?.(
        name,
        descriptionShaped,
        changeReason,
        defaultFolderName,
        defaultDescription
      );
    } else {
      await onCreateFolder?.(name, descriptionShaped);
    }
    reset();
  };

  return (
    <form className="min-w-0" onSubmit={handleSubmit(onSubmit)}>
      <Controller
        control={control}
        name="name"
        defaultValue=""
        render={({ field, fieldState: { error } }) => (
          <Field>
            <FieldLabel>Name</FieldLabel>
            <FieldContent>
              <Input {...field} placeholder="Type your folder name" />
            </FieldContent>
            {error && <FieldError>{error.message}</FieldError>}
          </Field>
        )}
      />
      <Controller
        control={control}
        name="description"
        defaultValue=""
        render={({ field, fieldState: { error } }) => (
          <Field className="mt-4">
            <FieldLabel>Description</FieldLabel>
            <FieldContent>
              <TextArea
                placeholder="Folder description"
                {...field}
                rows={3}
                ref={descriptionRef}
                onInput={handleInput}
                className="thin-scrollbar resize-none!"
                maxLength={255}
              />
            </FieldContent>
            {!error && showDescriptionOverwriteWarning && (
              <FieldDescription>{descriptionOverwriteWarningMessage}</FieldDescription>
            )}
            {error && <FieldError>{error.message}</FieldError>}
          </Field>
        )}
      />
      {isEdit && (
        <Controller
          control={control}
          name="changeReason"
          defaultValue=""
          render={({ field }) => (
            <Field className="mt-4">
              <FieldLabel>Change reason</FieldLabel>
              <FieldContent>
                <Input {...field} placeholder="Why is this folder changing?" maxLength={256} />
              </FieldContent>
            </Field>
          )}
        />
      )}
      <DialogFooter className="mt-4">
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="project" isPending={isSubmitting} isDisabled={isSubmitting}>
          {isEdit ? "Update" : "Add"} Folder
        </Button>
      </DialogFooter>
    </form>
  );
};
