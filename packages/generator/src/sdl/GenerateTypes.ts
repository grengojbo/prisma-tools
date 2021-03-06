import { DMMF } from '../schema';

export class GenerateTypes {
  code: string[] = [
    `import * as Prisma from '@prisma/client'`,
    `import { Context } from './context'`,
    `import { GraphQLResolveInfo } from 'graphql';`,
    `type Resolver<T extends {}, A extends {}, R extends any> = (parent: T,args: A, context: Context, info: GraphQLResolveInfo) => Promise<R>;`,
    `type CustomField = (parent: any,args: any, context: Context, info: GraphQLResolveInfo) => any`,
  ];
  scalar: { [key: string]: any } = {
    Int: 'number',
    Float: 'number',
    String: 'string',
    Boolean: 'boolean',
    DateTime: 'Date',
  };

  testedTypes: string[] = [];

  constructor(private dmmf: DMMF.Document) {}

  get schema() {
    return this.dmmf.schema;
  }

  capital(name: string) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  getOutputType(
    options: DMMF.SchemaField['outputType'] | DMMF.SchemaArgInputType,
    input = false,
  ) {
    switch (options.kind) {
      case 'scalar':
        return `${this.scalar[options.type as string]}${
          options.isList ? '[]' : ''
        }`;
      default:
        const type = options.type.toString().startsWith('Aggregate')
          ? `Get${options.type
              .toString()
              .replace('Aggregate', '')}AggregateType<${options.type}Args>`
          : options.type;
        return `${!input ? 'Prisma.' : ''}${type}${options.isList ? '[]' : ''}`;
    }
  }

  hasEmptyTypeFields(type: string) {
    this.testedTypes.push(type);
    const inputType = this.schema.inputTypes.find((item) => item.name === type);
    if (inputType) {
      if (inputType.fields.length === 0) return true;
      for (const field of inputType.fields) {
        const fieldType = this.getInputType(field);
        if (
          fieldType.type !== type &&
          fieldType.kind === 'object' &&
          !this.testedTypes.includes(fieldType.type as string)
        ) {
          const state = this.hasEmptyTypeFields(fieldType.type as string);
          if (state) return true;
        }
      }
    }
    return false;
  }

  getInputType(field: DMMF.SchemaArg) {
    let index = 0;
    if (field.inputTypes.length > 1 && field.inputTypes[1].kind === 'object') {
      index = 1;
    }
    return field.inputTypes[index];
  }

  run() {
    const outputTypes: string[] = [
      `export interface Resolvers {`,
      `[key: string]: {[key: string]: CustomField}`,
    ];
    const argsTypes: string[] = [];
    const resolversTypes: string[] = [];
    // generate Output types
    this.schema.outputTypes.forEach((type) => {
      outputTypes.push(`${type.name}?: ${type.name};`);
      const fields: string[] = [
        `export interface ${type.name} {`,
        `[key: string]: CustomField`,
      ];

      // generate fields
      type.fields.forEach((field) => {
        const parentType = ['Query', 'Mutation'].includes(type.name)
          ? '{}'
          : `Prisma.${type.name}`;
        const argsType =
          field.args.length > 0 ? `${this.capital(field.name)}Args` : '{}';
        fields.push(
          `${
            field.name
          }?: Resolver<${parentType}, ${argsType}, ${this.getOutputType(
            field.outputType,
          )}${field.isNullable ? ' | null' : ''}${
            !field.isRequired ? ' | undefined' : ''
          }>`,
        );

        // add findManyCount
        if (field.name.startsWith('findMany')) {
          fields.push(
            `${field.name}Count?: Resolver<${parentType}, ${argsType}, number>`,
          );
        }

        // generate args
        if (argsType !== '{}') {
          const args: string[] = [`export interface ${argsType} {`];
          field.args.forEach((arg) => {
            args.push(
              `${arg.name}${arg.isRequired ? '' : '?'}: ${this.getOutputType(
                arg.inputTypes[0],
                true,
              )}${field.isNullable ? ' | null' : ''}`,
            );
          });
          if (argsType.startsWith('Aggregate')) {
            const modelName = field.outputType.type
              .toString()
              .replace('Aggregate', '');
            args.push(
              `count?: true`,
              `avg?: Prisma.${modelName}AvgAggregateInputType`,
              `sum?: Prisma.${modelName}SumAggregateInputType`,
              `min?: Prisma.${modelName}MinAggregateInputType`,
              `max?: Prisma.${modelName}MaxAggregateInputType`,
            );
          }
          args.push('}');
          argsTypes.push(args.join('\n'));
        }
      });
      fields.push('}');
      resolversTypes.push(fields.join('\n'));
    });
    outputTypes.push('}');
    this.code.push(
      outputTypes.join('\n'),
      resolversTypes.join('\n\n'),
      argsTypes.join('\n\n'),
    );

    // generate input types
    const inputTypes: string[] = [];
    this.schema.inputTypes.forEach((input) => {
      if (input.fields.length > 0) {
        const fields: string[] = [`export interface ${input.name} {`];
        input.fields.forEach((field) => {
          const inputType = this.getInputType(field);
          const hasEmptyType =
            inputType.kind === 'object' &&
            this.hasEmptyTypeFields(inputType.type as string);
          if (!hasEmptyType) {
            fields.push(
              `${field.name}${
                field.isRequired ? '' : '?'
              }: ${this.getOutputType(inputType, true)}${
                field.isNullable ? ' | null' : ''
              }`,
            );
          }
        });
        fields.push('}');
        inputTypes.push(fields.join('\n'));
      }
    });
    this.code.push(inputTypes.join('\n\n'));

    // generate enums
    const enumsTypes: string[] = [];
    this.schema.enums.forEach((item) => {
      const values: string[] = [`export enum ${item.name} {`];
      item.values.forEach((item2) => {
        values.push(`${item2} = "${item2}",`);
      });
      values.push('}');
      enumsTypes.push(values.join('\n'));
    });
    this.code.push(enumsTypes.join('\n'));

    return this.code.join('\n\n');
  }
}
