/** 与后端 `data/icon-templates/store.json` 对齐 */

export interface IconTemplateItem {
  id: string;
  name: string;
  aliases: string[];
  note: string;
  /** 相对于 images 目录的文件名，无图则为 null */
  imageFile: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IconTemplateStoreFile {
  version: 1;
  updatedAt: string;
  items: IconTemplateItem[];
}

export interface IconTemplateListResponse {
  ok: boolean;
  storePath?: string;
  imagesPath?: string;
  error?: string;
  items: Array<
    IconTemplateItem & {
      imageUrl: string | null;
    }
  >;
}
