'use strict';

const fs = require('fs');
const path = require('path');
const { assertDefinitionId, resolveInside } = require('../core/path');
const { normalizeText } = require('../core/text');
const { analyzeGitignore } = require('./analyze');

/**
 * Run the extract component workflow.
 *
 * Enhanced: first analyzes the .gitignore against known components to identify
 * what's already covered, then extracts only the uncovered (unmatched) lines
 * as a new component. Warns if extraction could break current usage.
 *
 * Does NOT generate ignorekit.json — only produces component or preset files.
 *
 * @param {object} options
 * @param {string} options.id - Component identifier (e.g. local/runtime)
 * @param {string} options.from - Path to the source .gitignore file
 * @param {string} [options.outputRoot] - Output directory (default: .ignorekit)
 * @param {boolean} [options.full] - Extract the full .gitignore (skip analysis, legacy behavior)
 * @param {string} [options.distRoot] - Override dist root
 * @param {string} [options.userRoot] - User-level override directory
 * @param {string} [options.workspaceRoot] - Workspace-level definition directory
 * @param {object} env
 * @param {object} env.stdout - Writable stream for output
 * @param {string} [env.cwd] - Current working directory
 * @returns {{ outputPath: string, analysis: object|null, warnings: string[] }}
 */
function runExtractComponent(options, env) {
  const stdout = env.stdout || process.stdout;
  assertDefinitionId(options.id);
  const sourcePath = path.resolve(env.cwd || process.cwd(), options.from);
  const outputRoot = path.resolve(env.cwd || process.cwd(), options.outputRoot || '.ignorekit');
  const outputPath = resolveInside(outputRoot, path.join('components', `${options.id}.gitignore`));
  const source = fs.readFileSync(sourcePath, 'utf8');
  const warnings = [];

  // Legacy mode: extract the full .gitignore without analysis
  if (options.full) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, normalizeText(source), 'utf8');
    stdout.write(`Created component ${options.id} (full extraction, no analysis)\n`);
    return { outputPath, analysis: null, warnings };
  }

  // Analyze first — find what's already covered by known components
  const analysis = analyzeGitignore({
    gitignorePath: sourcePath,
    distRoot: options.distRoot,
    userRoot: options.userRoot,
    workspaceRoot: options.workspaceRoot
  });

  // Print analysis summary
  stdout.write(`Analyzing ${path.basename(sourcePath)} before extraction...\n\n`);

  if (analysis.matchedComponents.length > 0) {
    const fullMatches = analysis.matchedComponents.filter(c => c.classification === 'full');
    const partialMatches = analysis.matchedComponents.filter(c => c.classification === 'partial');
    stdout.write(`Already covered by ${analysis.matchedComponents.length} known component(s):\n`);
    for (const comp of analysis.matchedComponents) {
      const status = comp.classification === 'full' ? '✓ full' : '✗ partial';
      stdout.write(`  ${comp.id.padEnd(24)} ${comp.matched.length}/${comp.total} rules ${status}\n`);
    }
    stdout.write('\n');
  }

  // Extract only unmatched lines
  const unmatchedLines = analysis.unmatchedLines;

  if (unmatchedLines.length === 0) {
    stdout.write('All lines are already covered by known components.\n');
    stdout.write('Nothing to extract. Use --full to extract the entire .gitignore anyway.\n');
    return { outputPath: null, analysis, warnings };
  }

  // Build the component content from unmatched lines only
  const headerLine = `# Extracted from ${path.basename(sourcePath)} (unmatched rules only)`;
  const componentContent = normalizeText([headerLine, ...unmatchedLines].join('\n'));

  // Warn about partial matches — those components have rules NOT in the .gitignore
  // that would be added if the user adopts a preset containing them
  const partialMatches = analysis.matchedComponents.filter(c => c.classification === 'partial');
  if (partialMatches.length > 0) {
    warnings.push(
      `${partialMatches.length} component(s) are partially matched. ` +
      `If you adopt a preset containing these components, the generated .gitignore ` +
      `will include additional rules not in your current .gitignore:`
    );
    for (const comp of partialMatches) {
      if (comp.unmatched.length > 0) {
        warnings.push(`  ${comp.id}: adds ${comp.unmatched.join(', ')}`);
      }
    }
  }

  // Warn about fully matched components that will be duplicated if not using ignorekit
  const fullMatches = analysis.matchedComponents.filter(c => c.classification === 'full');
  if (fullMatches.length > 0) {
    warnings.push(
      `${fullMatches.length} component(s) are fully matched. ` +
      `Rules from these components appear in both the extracted component and the original components. ` +
      `Use ignorekit.json with the matching preset instead of the extracted component to avoid duplication.`
    );
  }

  // Write the component file
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, componentContent, 'utf8');

  // Print results
  stdout.write(`Extracted component ${options.id}:\n`);
  stdout.write(`  ${unmatchedLines.length} unmatched rule(s) written to ${outputPath}\n`);
  stdout.write(`  ${analysis.matchedComponents.reduce((s, c) => s + c.matched.length, 0)} rule(s) already covered by known components (not extracted)\n\n`);

  if (warnings.length > 0) {
    stdout.write('Warnings:\n');
    for (const w of warnings) {
      stdout.write(`  ${w}\n`);
    }
    stdout.write('\n');
  }

  // Suggest best preset if available
  if (analysis.bestPreset && analysis.bestPreset.score > 0) {
    stdout.write(`Suggestion: consider using preset "${analysis.bestPreset.id}" which covers ${analysis.bestPreset.fullCount}/${analysis.bestPreset.componentCount} matched components.\n`);
    stdout.write(`  You can then add the extracted component as an extra component in ignorekit.json.\n\n`);
  }

  return { outputPath, analysis, warnings };
}

module.exports = { runExtractComponent };
