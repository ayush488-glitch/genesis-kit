# Architecture figure

`genesis-architecture.tex` is the source of the README figure. It uses LaTeX, TikZ and Latin Modern fonts; no image-generation model is involved.

From the repository root, with Tectonic and Poppler available:

```sh
tectonic docs/assets/genesis-architecture.tex --outdir docs/assets
pdftoppm -png -singlefile -r 210 \
  docs/assets/genesis-architecture.pdf docs/assets/genesis-architecture
```

Commit the `.tex`, vector `.pdf` and rendered `.png` together. Tectonic may download TeX packages on its first run. These are documentation-build tools, not Genesis runtime dependencies.

The figure separates the development lifecycle, canonical repository state, generated context/recovery/views, and evaluated-learning path. Dashed arrows indicate feedback into later work. The trust-boundary note is part of the architecture: local files and working directories do not authenticate reviewers or isolate an evaluator.
