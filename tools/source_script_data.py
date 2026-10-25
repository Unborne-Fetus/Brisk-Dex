"""Export numeric script operands without evaluating C/Python source code."""
import ast, json, operator, re
from pathlib import Path

OPS={ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.FloorDiv:operator.floordiv,ast.Div:operator.floordiv,ast.Mod:operator.mod,ast.BitOr:operator.or_,ast.BitAnd:operator.and_,ast.BitXor:operator.xor,ast.LShift:operator.lshift,ast.RShift:operator.rshift}
def numeric(expression,values):
    expression=re.sub(r'(?<=\d)[uUlL]+\b','',expression.strip())
    def visit(node):
        if isinstance(node,ast.Constant) and isinstance(node.value,int):return node.value
        if isinstance(node,ast.Name):return values[node.id]
        if isinstance(node,ast.BinOp) and type(node.op) in OPS:
            left,right=visit(node.left),visit(node.right)
            if isinstance(node.op,(ast.LShift,ast.RShift)) and not 0<=right<=32:raise ValueError('shift')
            return OPS[type(node.op)](left,right)
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd,ast.Invert)):
            value=visit(node.operand);return -value if isinstance(node.op,ast.USub) else ~value if isinstance(node.op,ast.Invert) else value
        raise ValueError('Not an integer expression')
    value=visit(ast.parse(expression,mode='eval').body)
    if not -(2**32)<=value<2**32:raise ValueError('integer bound')
    return value

def script_data(repo,catalog,trainers):
    repo=Path(repo);values={};expressions={}
    headers='\n'.join(p.read_text() for p in sorted((repo/'include/constants').glob('*.h')))
    headers=re.sub(r'/\*.*?\*/','',headers,flags=re.S);headers=re.sub(r'//[^\n]*','',headers)
    for key,expression in re.findall(r'^\s*#define\s+(\w+)[ \t]+([^\n]+)',headers,re.M):expressions[key]=expression
    for _ in range(20):
        changed=False
        for key,expression in expressions.items():
            if key in values:continue
            try:values[key]=numeric(expression,values);changed=True
            except (ValueError,KeyError,SyntaxError,ZeroDivisionError,OverflowError):pass
        for body in re.findall(r'\benum\b[^{};]*\{([^{}]*)\}',headers,re.S):
            current=-1
            for token in body.split(','):
                match=re.fullmatch(r'\s*(\w+)(?:\s*=\s*(.*?))?\s*',token,re.S)
                if not match:continue
                key,expression=match.groups()
                try:current=numeric(expression,values) if expression else current+1
                except (ValueError,KeyError,SyntaxError,ZeroDivisionError,OverflowError):break
                if key not in values:values[key]=current;changed=True
        if not changed:break
    from source_save_constants import save_constants
    resolved=save_constants(repo)
    values.update({k:v for k,v in resolved.items() if k.startswith(('FLAG_','VAR_','TRAINER_')) or k in ['FLAGS_COUNT','VARS_COUNT','VARS_START','VARS_END','TRAINER_FLAGS_START','TRAINER_FLAGS_END','MAX_TRAINERS_COUNT']})
    for field,prefix in [('species','SPECIES_'),('moveDetails',''),('itemDetails','')]:
        for id,record in catalog[field].items():values[prefix+record['constant']]=int(id)
    text_source=(repo/'src/strings.c').read_text();text={name:''.join(re.findall(r'"((?:[^"\\]|\\.)*)"',body)) for name,body in re.findall(r'const u8 (\w+)\[\]\s*=\s*_\((.*?)\);',text_source,re.S)}
    return {'text':text,'constants':values,'trainers':{t['constant']:{'name':t['name'],'party':t['party'],'battleType':t.get('battleType')} for t in trainers if t.get('party')}}

if __name__=='__main__':
    import sys
    root=Path(__file__).resolve().parents[1]
    data=script_data(sys.argv[1],json.loads((root/'brisk-dex-data.json').read_text()),json.loads((root/'brisk-dex-trainer-teams.json').read_text())['trainers'])
    (root/'game/script-data.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
    print(f"Exported {len(data['constants'])} numeric operands and {len(data['trainers'])} trainer teams")
