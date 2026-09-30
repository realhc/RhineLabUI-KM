interface RhineCategory { id:string; name:string; lane:number; }
interface RhineDocument {
  id: string;
  title: string;
  category: string;
  categoryId?: string | null;
  order: number;
  created: string;
  modified: string;
  body: string;
  revision: string;
}
interface Window {
  rhine: {
    list(): Promise<{
      documents: RhineDocument[];
      trash: RhineDocument[];
      issues: unknown[];
      categories: RhineCategory[];
      nextLane: number;
    }>;
    create(data: {
      title: string;
      category: string;
      categoryId?: string | null;
      body: string;
    }): Promise<RhineDocument>;
    save(data: {
      id: string;
      title: string;
      category: string;
      categoryId?: string | null;
      body: string;
      revision: string;
    }): Promise<RhineDocument>;
    trash(id: string, revision: string): Promise<unknown>;
    restore(id: string): Promise<unknown>;
    purge(id: string): Promise<unknown>;
    reorder(ids: string[]): Promise<unknown>;
    createCategory(name:string): Promise<RhineCategory>;
    renameCategory(id:string,name:string): Promise<unknown>;
    removeCategory(id:string): Promise<unknown>;
    moveDocument(id:string,categoryId:string|null): Promise<RhineDocument>;
    exportPreferences(text: string): Promise<boolean>;
    openFolder(): Promise<unknown>;
    openExternal(url: string): Promise<unknown>;
    fullscreen(): Promise<unknown>;
    setDirty(dirty: boolean): void;
    onChanged(callback: () => void): () => void;
  };
}
