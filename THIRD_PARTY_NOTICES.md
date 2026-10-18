# Third-party notices

- Original Roseglass application code in current releases: restricted personal, non-commercial, no-derivatives license, see LICENSE. Copies previously and validly licensed under MIT retain those existing rights.
- Bundled Mozilla PDF.js: Apache-2.0, see mcp-reader/worker/vendor/LICENSE.
- Bundled tesseract.js-core 7.0.0: Apache-2.0, see mcp-reader/worker/ocr/LICENSE.
- Tesseract language data packages (1.0.0, 4.0.0_best_int variant): package metadata declares MIT; upstream Tesseract language models use Apache-2.0. This release embeds deu and chi_sim. Asset hashes and provenance: mcp-reader/worker/ocr/PROVENANCE.json.
- The standalone app downloads its rendering dependencies from public CDNs. Consult the corresponding projects' licenses when self-hosting those files.
- OCR test images are generated synthetic text examples; no lecture content is shipped as a test fixture.

Third-party components retain their separate original licenses; Roseglass restrictions do not override Apache-2.0, MIT, or other existing third-party rights. Any redistribution permitted under the relevant third-party license must retain its required notices. This statement **does not** authorize redistribution of Roseglass original code. Roseglass is not affiliated with or endorsed by OpenAI, Mozilla or the Tesseract project.
