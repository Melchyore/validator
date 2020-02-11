/*
 * @adonisjs/validator
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

import {
  SchemaArray,
  SchemaObject,
  SchemaLiteral,
  ValidationField,
} from '@ioc:Adonis/Core/Validator'

import { Compiler } from '../index'
import { CompilerBuffer } from '../Buffer'
import { LiteralCompiler } from './Literal'

/**
 * Exposes the API to compile the array node to a set of inline
 * Javascript instructions.
 */
export class ArrayCompiler {
  constructor (
    private field: ValidationField,
    private node: SchemaArray,
    private compiler: Compiler,
    private references: {
      outVariable: string,
      referenceVariable: string,
      parentPointer: ValidationField[],
    },
  ) {
  }

  /**
   * Declaring the out variable as an empty array. As the validations
   * will progress, this object will receive new properties
   */
  private declareOutVariable (buffer: CompilerBuffer, outVariable: string) {
    const referenceExpression = this.compiler.pointerToExpression(this.field)
    buffer.writeExpression(
      `const ${outVariable} = ${this.references.outVariable}[${referenceExpression}] = []`,
    )
  }

  /**
   * Add the if statement to ensure that the runtime value is an
   * array, before we attempt to validate it's members
   */
  private startIfGuard (buffer: CompilerBuffer, variableName: string) {
    buffer.writeStatement(
      `if (${this.compiler.getVariableExistsName(variableName)} && Array.isArray(${variableName})) {`,
    )
    buffer.indent()
  }

  /**
   * Ends the previously started if guard
   */
  private endIfGuard (buffer: CompilerBuffer) {
    buffer.dedent()
    buffer.writeStatement('}')
  }

  /**
   * Start the for loop to loop over the array entries. We use a `for of`
   * loop, since their are one or more children async rules
   */
  private startAsyncForLoop (buffer: CompilerBuffer, variableName: string, indexVariable: string) {
    buffer.writeStatement(`for (let [${indexVariable}] of ${variableName}.entries()) {`)
    buffer.indent()
  }

  /**
   * Start the for loop to loop over the array entries.
   */
  private startForLoop (buffer: CompilerBuffer, variableName: string, indexVariable: string) {
    buffer.writeStatement(
      `for (let ${indexVariable} = 0; ${indexVariable} < ${variableName}.length; ${indexVariable}++) {`,
    )
    buffer.indent()
  }

  /**
   * Ends the previously started for loop
   */
  private endForLoop (buffer: CompilerBuffer) {
    buffer.dedent()
    buffer.writeStatement('}')
  }

  /**
   * Returns a boolean telling if any of the children of a given node
   * has async rules. This helps in optimizing the for loop for
   * the array.
   */
  private hasAsyncChildren (node: SchemaArray | SchemaLiteral | SchemaObject) {
    if (node.rules.find((rule) => rule.async)) {
      return true
    }

    if (node.type === 'array' && node.each) {
      return this.hasAsyncChildren(node.each)
    }

    if (node.type === 'object') {
      const children = Object.keys(node.children)
      for (let child of children) {
        if (this.hasAsyncChildren(node.children[child])) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Converts the array node to compiled Javascript statement.
   */
  public compile (buff: CompilerBuffer) {
    if (!this.node.rules.length && !this.node.each) {
      return
    }

    /**
     * Parsing the object as a literal node with `array` subtype.
     */
    const literal = new LiteralCompiler(this.field, {
      type: 'literal' as const,
      subtype: 'array',
      rules: this.node.rules,
    }, this.compiler, this.references)

    /**
     * Disable output variable when the array node has members. Since we start
     * with an empty array and only collect the validated properties
     */
    literal.disableOutVariable = !!this.node.each

    /**
     * Always declare the value variable so that we can reference it to validate
     * the children of the array.
     */
    literal.forceValueDeclaration = true
    literal.compile(buff)

    /**
     * Do not output the compiled code for validating children, when no children
     * have been defined on the array
     */
    if (!this.node.each) {
      return
    }

    const hasAsyncChildren = this.hasAsyncChildren(this.node.each)

    buff.newLine()

    /**
     * Add a guard if statement to only validate children when the field
     * value is a valid array
     */
    this.startIfGuard(buff, literal.variableName)

    const indexVariable = `index_${this.compiler.arrayIndexVariableCounter++}`
    /**
     * Declaring the out variable as an empty array
     */
    const outVariable = `out_${this.compiler.outVariableCounter++}`
    this.declareOutVariable(buff, outVariable)

    /**
     * Add the for loop
     */
    if (hasAsyncChildren) {
      this.startAsyncForLoop(buff, literal.variableName, indexVariable)
    } else {
      this.startForLoop(buff, literal.variableName, indexVariable)
    }

    /**
     * Parse members
     */
    buff.newLine()
    this.compiler.compileNode(
      { name: indexVariable, type: 'identifier' },
      this.node.each,
      buff,
      this.references.parentPointer.concat(this.field),
      literal.variableName,
      outVariable,
    )

    /**
     * End for loop and if guard
     */
    this.endForLoop(buff)
    this.endIfGuard(buff)
  }
}
