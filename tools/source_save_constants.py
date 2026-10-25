"""Resolve save flags/variables using the C preprocessor's Emerald branches."""
import re,subprocess
from source_script_data import numeric

def save_constants(source,trainer_count=None):
 text='#include "config/general.h"\n#include "constants/flags.h"\n#include "constants/vars.h"\n'
 if trainer_count is not None:text+='\n#undef MAX_TRAINERS_COUNT\n#define MAX_TRAINERS_COUNT '+str(trainer_count)+'\n'
 output=subprocess.check_output(['cpp','-dM','-I',str(source/'include'),'-DGAME_VERSION=VERSION_EMERALD','-DGAME_LANGUAGE=LANGUAGE_ENGLISH','-'],input=text,text=True)
 expressions=dict(re.findall(r'^#define\s+(\w+)[ \t]+([^\n]+)',output,re.M));values={}
 for _ in range(60):
  changed=False
  for name,expression in expressions.items():
   try:value=numeric(expression,values)
   except (ValueError,KeyError,SyntaxError,ZeroDivisionError,OverflowError):continue
   if values.get(name)!=value:values[name]=value;changed=True
  if not changed:break
 return values
