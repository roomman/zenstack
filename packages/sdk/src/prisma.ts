import { GeneratorDecl, Model, Plugin, isGeneratorDecl, isPlugin } from './ast';
import { getLiteral } from './utils';
import path from 'path';

/**
 * Given a ZModel and an import context directory, compute the import spec for the Prisma Client.
 */
export function getPrismaClientImportSpec(model: Model, importingFromDir: string) {
    const generator = model.declarations.find(
        (d) =>
            isGeneratorDecl(d) &&
            d.fields.some((f) => f.name === 'provider' && getLiteral(f.value) === 'prisma-client-js')
    ) as GeneratorDecl;

    const clientOutputField = generator?.fields.find((f) => f.name === 'output');
    const clientOutput = getLiteral(clientOutputField?.value);

    if (!clientOutput) {
        // no user-declared Prisma Client output location
        return '@prisma/client';
    }

    if (path.isAbsolute(clientOutput)) {
        // absolute path
        return clientOutput;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const zmodelDir = path.dirname(model.$document!.uri.fsPath);

    // compute prisma schema absolute output path
    let prismaSchemaOutputDir = path.resolve(zmodelDir, './prisma');
    const prismaPlugin = model.declarations.find(
        (d) => isPlugin(d) && d.fields.some((f) => f.name === 'provider' && getLiteral(f.value) === '@core/prisma')
    ) as Plugin;
    if (prismaPlugin) {
        const output = getLiteral(prismaPlugin.fields.find((f) => f.name === 'output')?.value);
        if (output) {
            if (path.isAbsolute(output)) {
                // absolute prisma schema output path
                prismaSchemaOutputDir = path.dirname(output);
            } else {
                prismaSchemaOutputDir = path.dirname(path.resolve(zmodelDir, output));
            }
        }
    }

    // resolve the prisma client output path, which is relative to the prisma schema
    const resolvedPrismaClientOutput = path.resolve(prismaSchemaOutputDir, clientOutput);

    // DEBUG:
    // console.log('PRISMA SCHEMA PATH:', prismaSchemaOutputDir);
    // console.log('PRISMA CLIENT PATH:', resolvedPrismaClientOutput);
    // console.log('IMPORTING PATH:', importingFromDir);

    // compute prisma client absolute output dir relative to the importing file
    return path.relative(importingFromDir, resolvedPrismaClientOutput);
}