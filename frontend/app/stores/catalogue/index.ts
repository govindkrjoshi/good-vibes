export type CatalogueEntry = {
  readonly name: string;
};

export type Catalogue = Readonly<
  Record<string, Readonly<Record<string, CatalogueEntry>>>
>;

export const CATALOGUE: Catalogue = {
  source: {
    AMOscillator: {
      name: "AMOscillator",
    },
  },
};
