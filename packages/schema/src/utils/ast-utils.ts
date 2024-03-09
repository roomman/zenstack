import {
    BinaryExpr,
    DataModel,
    DataModelField,
    Expression,
    InheritableNode,
    isArrayExpr,
    isBinaryExpr,
    isDataModel,
    isDataModelField,
    isInvocationExpr,
    isMemberAccessExpr,
    isModel,
    isReferenceExpr,
    Model,
    ModelImport,
    ReferenceExpr,
} from '@zenstackhq/language/ast';
import { isDelegateModel, isFromStdlib } from '@zenstackhq/sdk';
import {
    AstNode,
    copyAstNode,
    CstNode,
    getContainerOfType,
    getDocument,
    LangiumDocuments,
    Linker,
    Mutable,
    Reference,
} from 'langium';
import { URI, Utils } from 'vscode-uri';

export function extractDataModelsWithAllowRules(model: Model): DataModel[] {
    return model.declarations.filter(
        (d) => isDataModel(d) && d.attributes.some((attr) => attr.decl.ref?.name === '@@allow')
    ) as DataModel[];
}

type BuildReference = (
    node: AstNode,
    property: string,
    refNode: CstNode | undefined,
    refText: string
) => Reference<AstNode>;

export function mergeBaseModel(model: Model, linker: Linker) {
    const buildReference = linker.buildReference.bind(linker);

    model.declarations.filter(isDataModel).forEach((decl) => {
        const dataModel = decl as DataModel;

        const bases = getRecursiveBases(dataModel).reverse();
        if (bases.length > 0) {
            dataModel.fields = bases
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                .flatMap((base) => base.fields)
                // don't inherit skip-level fields
                .filter((f) => !f.$inheritedFrom)
                .map((f) => cloneAst(f, dataModel, buildReference))
                .concat(dataModel.fields);

            dataModel.attributes = bases
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                .flatMap((base) => base.attributes)
                // don't inherit skip-level attributes
                .filter((attr) => !attr.$inheritedFrom)
                // don't inherit `@@delegate` attribute
                .filter((attr) => attr.decl.$refText !== '@@delegate')
                .map((attr) => cloneAst(attr, dataModel, buildReference))
                .concat(dataModel.attributes);
        }

        dataModel.$baseMerged = true;
    });

    // remove abstract models
    model.declarations = model.declarations.filter((x) => !(isDataModel(x) && x.isAbstract));
}

// deep clone an AST, relink references, and set its container
function cloneAst<T extends InheritableNode>(
    node: T,
    newContainer: AstNode,
    buildReference: BuildReference
): Mutable<T> {
    const clone = copyAstNode(node, buildReference) as Mutable<T>;
    clone.$container = newContainer;
    clone.$containerProperty = node.$containerProperty;
    clone.$containerIndex = node.$containerIndex;
    clone.$inheritedFrom = node.$inheritedFrom ?? getContainerOfType(node, isDataModel);
    return clone;
}

export function getIdFields(dataModel: DataModel) {
    const fieldLevelId = getModelFieldsWithBases(dataModel).find((f) =>
        f.attributes.some((attr) => attr.decl.$refText === '@id')
    );
    if (fieldLevelId) {
        return [fieldLevelId];
    } else {
        // get model level @@id attribute
        const modelIdAttr = dataModel.attributes.find((attr) => attr.decl?.ref?.name === '@@id');
        if (modelIdAttr) {
            // get fields referenced in the attribute: @@id([field1, field2]])
            if (!isArrayExpr(modelIdAttr.args[0]?.value)) {
                return [];
            }
            const argValue = modelIdAttr.args[0].value;
            return argValue.items
                .filter((expr): expr is ReferenceExpr => isReferenceExpr(expr) && !!getDataModelFieldReference(expr))
                .map((expr) => expr.target.ref as DataModelField);
        }
    }
    return [];
}

export function isAuthInvocation(node: AstNode) {
    return isInvocationExpr(node) && node.function.ref?.name === 'auth' && isFromStdlib(node.function.ref);
}

export function isFutureInvocation(node: AstNode) {
    return isInvocationExpr(node) && node.function.ref?.name === 'future' && isFromStdlib(node.function.ref);
}

export function getDataModelFieldReference(expr: Expression): DataModelField | undefined {
    if (isReferenceExpr(expr) && isDataModelField(expr.target.ref)) {
        return expr.target.ref;
    } else if (isMemberAccessExpr(expr) && isDataModelField(expr.member.ref)) {
        return expr.member.ref;
    } else {
        return undefined;
    }
}

export function resolveImportUri(imp: ModelImport): URI | undefined {
    if (imp.path === undefined || imp.path.length === 0) {
        return undefined;
    }
    const dirUri = Utils.dirname(getDocument(imp).uri);
    let grammarPath = imp.path;
    if (!grammarPath.endsWith('.zmodel')) {
        grammarPath += '.zmodel';
    }
    return Utils.resolvePath(dirUri, grammarPath);
}

export function resolveTransitiveImports(documents: LangiumDocuments, model: Model): Model[] {
    return resolveTransitiveImportsInternal(documents, model);
}

function resolveTransitiveImportsInternal(
    documents: LangiumDocuments,
    model: Model,
    initialModel = model,
    visited: Set<URI> = new Set(),
    models: Set<Model> = new Set()
): Model[] {
    const doc = getDocument(model);
    if (initialModel !== model) {
        models.add(model);
    }
    if (!visited.has(doc.uri)) {
        visited.add(doc.uri);
        for (const imp of model.imports) {
            const importedModel = resolveImport(documents, imp);
            if (importedModel) {
                resolveTransitiveImportsInternal(documents, importedModel, initialModel, visited, models);
            }
        }
    }
    return Array.from(models);
}

export function resolveImport(documents: LangiumDocuments, imp: ModelImport): Model | undefined {
    const resolvedUri = resolveImportUri(imp);
    try {
        if (resolvedUri) {
            const resolvedDocument = documents.getOrCreateDocument(resolvedUri);
            const node = resolvedDocument.parseResult.value;
            if (isModel(node)) {
                return node;
            }
        }
    } catch {
        // NOOP
    }
    return undefined;
}

export function getAllDeclarationsFromImports(documents: LangiumDocuments, model: Model) {
    const imports = resolveTransitiveImports(documents, model);
    return model.declarations.concat(...imports.map((imp) => imp.declarations));
}

export function isCollectionPredicate(node: AstNode): node is BinaryExpr {
    return isBinaryExpr(node) && ['?', '!', '^'].includes(node.operator);
}

export function getContainingDataModel(node: Expression): DataModel | undefined {
    let curr: AstNode | undefined = node.$container;
    while (curr) {
        if (isDataModel(curr)) {
            return curr;
        }
        curr = curr.$container;
    }
    return undefined;
}

export function getModelFieldsWithBases(model: DataModel, includeDelegate = true) {
    if (model.$baseMerged) {
        return model.fields;
    } else {
        return [...model.fields, ...getRecursiveBases(model, includeDelegate).flatMap((base) => base.fields)];
    }
}

export function getRecursiveBases(dataModel: DataModel, includeDelegate = true): DataModel[] {
    const result: DataModel[] = [];
    dataModel.superTypes.forEach((superType) => {
        const baseDecl = superType.ref;
        if (baseDecl) {
            if (!includeDelegate && isDelegateModel(baseDecl)) {
                return;
            }
            result.push(baseDecl);
            result.push(...getRecursiveBases(baseDecl));
        }
    });
    return result;
}

/**
 * Walk upward from the current AST node to find the first node that satisfies the predicate.
 */
export function findUpAst(node: AstNode, predicate: (node: AstNode) => boolean): AstNode | undefined {
    let curr: AstNode | undefined = node;
    while (curr) {
        if (predicate(curr)) {
            return curr;
        }
        curr = curr.$container;
    }
    return undefined;
}
